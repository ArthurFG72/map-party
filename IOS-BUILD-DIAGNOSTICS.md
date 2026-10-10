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

- **Validador CocoaPods chamava métodos inexistentes.** `Pod::Specification` não oferece `source_files` nem `attributes` nessa API. A validação agora chama `pod ipc spec` e verifica o JSON emitido pelo CocoaPods.
- **Nearby compilava no projeto principal, mas não era importável no pod Expo.** O Swift Package Manager ligava `NearbyConnections` ao target da aplicação, enquanto `MapPartyLocalTransport.swift` compila no target CocoaPods `MapPartyLocalTransport`. O log confirmou que `SWIFT_INCLUDE_PATHS` não resolve isso: o pod precisa declarar e linkar seu próprio produto SPM. O plugin `withNearbyConnections` agora acrescenta a referência fixa do pacote, a dependência de produto e a fase de link diretamente ao target CocoaPods depois da geração. O log do build mostrou que `$(BUILD_ROOT)` aponta para `Build/Products` nesse target, e por isso o primeiro caminho adicionado estava errado. Xcode salva o módulo em `Build/Intermediates.noindex/NearbyConnections.build/<configuração-plataforma>/NearbyConnections.build/Objects-normal/<arquitetura>`. O plugin usa `$(OBJROOT)` para adicionar o diretório correto a `SWIFT_INCLUDE_PATHS` após `react_native_post_install`, que sobrescreve ajustes anteriores. O `#error` de `MAP_PARTY_REQUIRE_NEARBY` continua intencional para impedir um release que silenciosamente desative comunicação local.
- **O módulo Expo não podia adotar `URLSessionTaskDelegate`.** Esse protocolo herda `NSObjectProtocol`; `Module` não herda de `NSObject`. `MapPartyBackgroundUploadDelegate`, uma classe `NSObject` separada, recebe os callbacks e encaminha o resultado ao módulo.
- **Fallback do transporte tinha assinatura incompatível.** `send(json:)` agora mantém o contrato assíncrono `Bool` também quando Nearby não está disponível, evitando erros secundários pouco claros no `AsyncFunction`.
- **Falha antes da compilação não tinha diagnóstico do projeto.** O script consulta a API autenticada do GitHub, mostra a anotação de criação do job e baixa os logs completos. Assim é possível distinguir cobrança/permissão/runner de dependências, prebuild e erros Swift.

## Ao alterar o app

1. Mantenha os fontes e integrações iOS em `mobile/modules/**/ios` e nos config plugins iOS. Mudanças Android ficam em `mobile/android`; a compatibilidade funcional deve seguir os contratos mobile compartilhados.
2. Se adicionar um Swift Package importado por um módulo CocoaPods local, verifique se o produto também está no caminho de módulos do target CocoaPods após `react_native_post_install`. Uma dependência apenas no target da aplicação não torna o módulo importável pelo pod.
3. Preserve assinaturas equivalentes entre o transporte Nearby real e o fallback e mantenha `MAP_PARTY_REQUIRE_NEARBY` no build de release.
4. Rode `npm test -w mobile`, valide o YAML e execute o workflow macOS. O ambiente local Windows não substitui a compilação Xcode para dispositivo.
5. Se a visibilidade pública for usada para permitir runners macOS gratuitos, lembre-se de que código, histórico, logs e artefatos ficam públicos durante esse período e cópias externas podem persistir após tornar o repositório privado.
