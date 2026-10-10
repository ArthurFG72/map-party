# Diagnóstico e compilação iOS

Este documento registra as causas encontradas nos builds de outubro de 2026 e as verificações que evitam a repetição. A trilha iOS é compilada no Xcode/macOS; as fontes, permissões e integração CocoaPods deste documento não alteram o build Android.

## Executar e diagnosticar

O workflow `.github/workflows/ios-unsigned-ipa.yml` roda os testes mobile, verifica Swift/CocoaPods, gera novamente o projeto iOS com `expo prebuild` e compila para `iphoneos`. Para um run existente, use a credencial GitHub já configurada no Git Credential Manager:

```powershell
.\scripts\diagnose-ios-workflow.ps1 -RunId <ID_DO_RUN>
```

O relatório mostra commit, estado do runner, etapas, anotações, linhas relevantes do log da etapa que falhou e artefatos disponíveis. O script não imprime a credencial. As anotações e logs do GitHub detectam também falhas anteriores à compilação, como runner não iniciado por limite/cobrança.

O workflow guarda `xcodebuild.log`, `prebuild-ios.log`, `Podfile`, `Podfile.lock` e diagnósticos do runner quando esses arquivos existem. Corrija a primeira etapa com falha; etapas posteriores aparecem como ignoradas porque dependem dela.

## Causas corrigidas

- **Fechamento reportado após a primeira autorização de localização — causa provável identificada no código.** O primeiro GPS podia iniciar uma sessão `URLSessionConfiguration.background` com `uploadTask(with:from:)`, que passa JSON em `Data`; para sessão em segundo plano, o upload precisa vir de arquivo. Esse caminho foi acrescentado depois do artefato anterior e coincide com o momento relatado. O módulo iOS agora grava o payload pendente em `Caches/MapPartyBackgroundUploads` e usa `uploadTask(with:fromFile:)`, removendo o arquivo ao concluir. O teste `nativeTransportContract.test.js` impede a volta ao overload incompatível. Sem o relatório `.ips` do aparelho, a ligação final com o encerramento ainda depende de confirmação no teste físico.
- **Regressão de precisão e posição crua no IPA 38082195145.** O commit `55e4f57` reduziu o GPS nativo de tracking para `kCLLocationAccuracyNearestTenMeters` e filtro de 20 m, revertendo a configuração de precisão alta aplicada em `c75a9ba`. O mesmo commit passou a enviar toda leitura nativa diretamente ao endpoint com `forceBroadcast`, inclusive com o app aberto; isso contornava `stabilizePosition` e podia sobrescrever uma coordenada filtrada. A configuração anterior foi restaurada, o upload direto ficou restrito ao app em segundo plano e a fixes com precisão de até 60 m e idade entre -30 e 120 s. O hook iOS agora também rejeita precisão inválida ou acima de 60 m antes de aceitar o primeiro ponto. As regras existentes de rejeição de saltos, deriva estacionária, velocidade fantasma e confirmação de movimento foram preservadas.
- **Validador CocoaPods chamava métodos inexistentes.** `Pod::Specification` não oferece `source_files` nem `attributes` nessa API. A validação agora chama `pod ipc spec` e verifica o JSON emitido pelo CocoaPods.
- **Nearby compilava no projeto principal, mas não era importável no pod Expo.** O Swift Package Manager ligava `NearbyConnections` ao target da aplicação, enquanto `MapPartyLocalTransport.swift` compila no target CocoaPods `MapPartyLocalTransport`. O log confirmou que `SWIFT_INCLUDE_PATHS` não resolve isso: o pod precisa declarar e linkar seu próprio produto SPM. O plugin `withNearbyConnections` agora acrescenta a referência fixa do pacote, a dependência de produto e a fase de link diretamente ao target CocoaPods depois da geração. O log do build mostrou que `$(BUILD_ROOT)` aponta para `Build/Products` nesse target, e por isso o primeiro caminho adicionado estava errado. Xcode salva o módulo em `Build/Intermediates.noindex/NearbyConnections.build/<configuração-plataforma>/NearbyConnections.build/Objects-normal/<arquitetura>`. O plugin usa `$(OBJROOT)` para adicionar o diretório correto a `SWIFT_INCLUDE_PATHS` após `react_native_post_install`, que sobrescreve ajustes anteriores. O `#error` de `MAP_PARTY_REQUIRE_NEARBY` continua intencional para impedir um release que silenciosamente desative comunicação local.
- **A versão fixada de Nearby exige callbacks de stream e recurso.** Depois que o módulo passou a ser importado pelo target, o Xcode revelou que `ConnectionManagerDelegate` exige assinaturas além do callback de bytes usado pelo app. O contrato MAPS troca envelopes JSON com `Data` e limite de 16 KB; callbacks de stream e arquivo fecham/desconectam o endpoint porque não fazem parte do protocolo MAPS. Isso evita aceitar payloads fora do contrato de mensagens.
- **O módulo Expo não podia adotar `URLSessionTaskDelegate`.** Esse protocolo herda `NSObjectProtocol`; `Module` não herda de `NSObject`. `MapPartyBackgroundUploadDelegate`, uma classe `NSObject` separada, recebe os callbacks e encaminha o resultado ao módulo.
- **Fallback do transporte tinha assinatura incompatível.** `send(json:)` agora mantém o contrato assíncrono `Bool` também quando Nearby não está disponível, evitando erros secundários pouco claros no `AsyncFunction`.
- **Falha antes da compilação não tinha diagnóstico do projeto.** O script consulta a API autenticada do GitHub, mostra a anotação de criação do job e baixa os logs completos. Assim é possível distinguir cobrança/permissão/runner de dependências, prebuild e erros Swift.

## Correção do fluxo inicial de permissões iOS (10/10/2026)

O relato de encerramento ao entrar no mapa ainda não tem um `.ips` do iPhone que confirme a pilha nativa. A revisão do fluxo encontrou uma condição concreta capaz de sobrepor solicitações do sistema: o Nearby iniciava na montagem da tela enquanto o CoreLocation solicitava localização em primeiro plano e, em seguida, acesso em segundo plano. Além disso, o módulo compartilhava uma única `CheckedContinuation` entre chamadas concorrentes e podia considerar `authorizedWhenInUse` como resposta positiva a um pedido de acesso `Always`.

As correções mantêm o GPS e o transporte local:

- No iOS, o Nearby só começa depois de o pedido de localização terminar, inclusive com negação, erro ou timeout de 20 segundos no pedido `Always`. O mapa e o GPS em primeiro plano continuam disponíveis enquanto isso.
- Os pedidos CoreLocation agora são enfileirados na fila principal; cada chamada recebe uma resposta própria. `authorizedWhenInUse` não é confundido com `authorizedAlways`.
- O start nativo do Nearby é idempotente para a mesma party e identidade; ao trocar de identidade ou parar, o transporte fecha os endpoints confiáveis antes de liberar os objetos.
- As descrições de uso Bluetooth, rede local e localização estão no `mobile/app.json` com finalidade ligada às funções do app. O teste mobile verifica a presença dessas descrições e a ordem do fluxo.

`npm test -w mobile` valida contratos e regressões JavaScript. A permissão real, a apresentação das folhas de sistema e a ausência de encerramento ainda exigem instalar e executar um build assinado em iPhone físico; o build unsigned não comprova esse comportamento. Se o app ainda fechar, recolher o relatório `.ips` antes de atribuir a causa ao Nearby.

## Build validado

**Critério de sucesso:** o workflow produz apenas o IPA unsigned solicitado. Build e empacotamento não significam instalação ou validação funcional no iPhone. Não assine o artefato nem adicione credenciais Apple sem solicitação explícita. Um iPhone convencional exige app assinado e perfil de provisionamento para instalar/executar; portanto não prometa instalação direta sem assinatura. Não altere `CODE_SIGNING_ALLOWED=NO` para resolver prompts de instalação. A assinatura de distribuição permanece reservada para depois da aprovação total.

Em 10/10/2026, o run [38082195145](https://github.com/ArthurFG72/map-party/actions/runs/38082195145) concluiu com sucesso os testes mobile, validação CocoaPods, geração do projeto e build nativo para `iphoneos`; o workflow empacotou o IPA unsigned. A cópia baixada está em `mobile/dist-ios-current/MapParty-ios-unsigned.ipa`; ela não valida instalação em iPhone sem assinatura.

## Ao alterar o app

1. Mantenha os fontes e integrações iOS em `mobile/modules/**/ios` e nos config plugins iOS. Mudanças Android ficam em `mobile/android`; a compatibilidade funcional deve seguir os contratos mobile compartilhados.
2. Se adicionar um Swift Package importado por um módulo CocoaPods local, verifique se o produto também está no caminho de módulos do target CocoaPods após `react_native_post_install`. Uma dependência apenas no target da aplicação não torna o módulo importável pelo pod.
3. Preserve assinaturas equivalentes entre o transporte Nearby real e o fallback e mantenha `MAP_PARTY_REQUIRE_NEARBY` no build de release.
4. Rode `npm test -w mobile`, valide o YAML e execute o workflow macOS. O ambiente local Windows não substitui a compilação Xcode para dispositivo.
5. Se a visibilidade pública for usada para permitir runners macOS gratuitos, lembre-se de que código, histórico, logs e artefatos ficam públicos durante esse período e cópias externas podem persistir após tornar o repositório privado.
