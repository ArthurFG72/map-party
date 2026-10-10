# Continuidade da sessão MAPS

Atualizado em 2026-10-09. Este documento é um resumo operacional para retomar o trabalho em uma nova sessão.

## Política de modelos confirmada pelo usuário em 2026-10-09

- Codex Luna é o orquestrador econômico da oficina.
- Sol é especialista sob demanda para problemas complexos; não assume a coordenação cotidiana.
- Uma etapa por vez, dono único, contexto mínimo e saída curta. Especialistas aguardam delegação concreta.
- Configuração divergente observada na retomada: Web Support, Crivo e Deploy Support em Ollama/qwen2.5-coder:3b; Forge, Harbor e Anchor em GPT-6.1-Sol; Atlas, Sentinel e Prism em GPT-5.6-Luna. Estado observado não significa configuração aprovada.
- A troca do modelo do maestro ainda precisa ser confirmada na interface da sessão; este registro não altera o modelo em execução.
- Retomar a mudança estrutural de recuperação e robustez em “Estado desta rodada (2026-10-09)”, preservando o diff local.

## Objetivo atual

Implementar offline robusto no aplicativo nativo MAPS, permitindo comunicação direta entre aparelhos Android e iOS próximos, sem roteador e sem internet, usando os recursos nativos disponíveis. O canal deve suportar localização, SOS, mensagens e compartilhamento de rota.

## Decisão técnica

- Não depender do hotspot pessoal do iPhone.
- Não depender de um roteador Wi-Fi.
- Usar Google Nearby Connections como abstração multiplataforma, pois combina Bluetooth/BLE/Wi-Fi ponto a ponto e funciona offline entre Android e iOS.
- Manter Socket.IO como canal principal quando houver internet.
- Usar o transporte local como fallback de curto alcance.
- Rota e mensagens precisam ser transmitidas em payloads validados, com tamanho máximo, TTL, deduplicação, identificador de mensagem, controle de saltos e confirmação.

Referências oficiais consultadas:

- https://developers.google.com/nearby/connections/overview
- https://developers.google.com/nearby/connections/strategies
- https://developer.apple.com/documentation/technotes/tn3111-ios-wifi-api-overview
- https://developer.android.com/reference/android/net/wifi/WifiManager

## Estado já implementado

### Correção de velocidade e posição

Alterações anteriores já feitas localmente:

- `mobile/src/hooks/useParty.js`
  - heartbeat de localização;
  - envio forçado antes de recalcular rota;
  - watchdog de velocidade;
  - uso de `serverReceivedAt` para frescor do marcador.
- `mobile/src/locationUpdate.js`
  - suporte a `forceBroadcast`.
- `server/src/validation.js` e `server/src/socket.js`
  - aceitam e propagam o broadcast forçado.
- Testes adicionados em `server/test/socket.test.js` e `server/test/validation.test.js`.

Resultado anterior: testes do servidor 72/72 e testes mobile 83/83 aprovados; `git diff --check` aprovado.

### Transporte local nativo

Arquivos principais:

- `mobile/src/localTransport.js`
  - fila offline limitada a 20 itens;
  - filtro por `roomId`;
  - ponte `globalThis.MapPartyLocalTransport`;
  - encaminhamento de eventos nativos;
  - envio de localização e SOS quando o bridge está disponível.
- `mobile/App.js`
  - adapta `NativeModules.MapPartyLocalTransport` e o módulo Expo para a ponte JavaScript.
- `mobile/android/app/src/main/java/com/arthur/mapparty/MapPartyLocalTransportModule.kt`
  - Google Nearby Connections;
  - `P2P_CLUSTER`;
  - descoberta, advertising, conexão e payloads;
  - permissões Bluetooth/Wi-Fi próximas.
- `mobile/modules/map-party-local-transport/ios/MapPartyNearbyTransport.swift`
  - pacote iOS Nearby Connections;
  - mesmo `serviceID` do Android;
  - validação de sala, TTL, deduplicação e relay.
- `mobile/modules/map-party-local-transport/ios/MapPartyLocalTransportModule.swift`
  - módulo Expo com `start`, `stop`, `sendJson` e `verify`.
- `mobile/plugins/withNearbyConnections.js`
  - adiciona o pacote Swift Nearby Connections durante o prebuild iOS.
- `mobile/NATIVE_TRANSPORT.md`
  - contrato e limitações do transporte nativo.

### Correções aplicadas nesta retomada

- `mobile/src/localTransport.js`
  - envelope comum com `messageId`, `createdAt`, `expiresAt` e `hops`;
  - limite de 16 KB, TTL de 180 s e deduplicação local;
  - mensagens que o native bridge retorna como `false` permanecem na fila;
  - flush da fila ao iniciar/reconectar.
- `mobile/src/hooks/useParty.js`
  - mensagens diretas funcionam pelo transporte local quando offline;
  - convites e respostas de compartilhamento de rota funcionam localmente;
  - filtro por participante destinatário e confirmação explícita no aparelho.
- `mobile/src/screens/PartyScreen.js`
  - o convite offline usa a rota efetivamente navegada, não somente a rota global.
- `mobile/android/app/src/main/java/com/arthur/mapparty/MapPartyLocalTransportModule.kt`
  - valida envelope, sala, TTL, tamanho, saltos e deduplicação;
  - retransmite payloads válidos aos demais peers até o limite de saltos.
- `mobile/test/localTransport.test.js`
  - adicionados testes de envelope, expiração, deduplicação e reenvio após `false`.

Após essas alterações: 85 testes mobile e 72 testes do servidor passaram; a compilação Android `:app:compileDebugKotlin` passou.

## Lacunas que ainda precisam ser implementadas

1. A confirmação física Android↔iPhone ainda não existe; testes JavaScript e compilação não provam descoberta de rádio.
2. É necessário revisar background: o Android tem serviço foreground de localização, mas não necessariamente do transporte Nearby; o iOS pode suspender descoberta em segundo plano.
3. O Android e o iOS ainda precisam ser testados com payload de rota próximo do limite de 16 KB.
4. O README ainda descreve o transporte nativo como futuro; atualizar depois do teste físico.

## Bloqueio atual do executor

O executor apresentou repetidamente:

`helper_unknown_error: setup refresh had errors`

Em uma tentativa respondeu `executor-ok`, mas voltou a falhar logo depois. Isso ocorre antes da criação do processo e não é causado pelo código MAPS.

Foi criado:

- `scripts/executor-guard.ps1`

Esse script testa o executor antes de um comando, tenta novamente até três vezes e falha com mensagem clara. Ele ainda não foi validado completamente porque o próprio executor ficou instável.

Ao iniciar nova sessão, executar primeiro:

```powershell
maestri list
Write-Output executor-ok
```

Se `Write-Output executor-ok` falhar com `setup refresh`, não editar nem publicar. Recuperar/reconectar o executor e repetir o teste.

### Causa raiz confirmada em 2026-10-09

O log `C:\Users\Arthur\.codex\.sandbox\sandbox.2026-10-09.log` registrou:

- `node_repl.exe` bloqueado por outro processo (`os error 32`);
- falha ao conceder ACE em `C:\` (`SetNamedSecurityInfoW failed: 5`, acesso negado);
- falhas de ACL em `C:\Users\Arthur\.codex\.sandbox-bin`;
- múltiplas instâncias simultâneas de Codex/app-server abertas.

Isso explica por que reinstalar o aplicativo não resolveu: processos antigos e locks/ACLs persistem no ambiente do Windows. Foi criado `scripts/codex-executor-recover.ps1`. Execute-o em um PowerShell externo, com todas as sessões Codex fechadas:

```powershell
Set-Location C:\Users\Arthur\Documents\MAPS
powershell -ExecutionPolicy Bypass -File .\scripts\codex-executor-recover.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\codex-executor-recover.ps1 -Apply
```

O script não altera ACL, não remove arquivos e não toca no MAPS; apenas diagnostica e, com `-Apply`, encerra processos Codex órfãos. Se ainda houver processo ou lock, reiniciar o Windows é o próximo passo seguro. Não executar `-Apply` dentro de uma sessão Codex.

## Equipe Maestri existente

Não recrutar duplicatas. Papéis conectados:

- Atlas — Arquiteto GIS
- Forge — Engenheiro Android Nativo
- Harbor — Engenheiro iOS Nativo
- Prism — Compatibilidade de Plataformas
- Sentinel — Revisor QA
- Web Support — Implementador Full-Stack
- Deploy Support — Executor de Testes
- Crivo — Avaliador de Alternativas
- Anchor — Confiabilidade de Release

O Groq foi removido conforme pedido do usuário. Gemini e JEV/TypeSafe permanecem como assistentes de pesquisa/validação quando configurados; sugestões devem ser validadas antes de aplicação.

## Procedimento obrigatório ao retomar

1. Ler `AGENTS.md`, `RUNBOOK.md` e este documento.
2. Executar `maestri list` e confirmar os papéis sem recrutar duplicatas.
3. Testar `Write-Output executor-ok` várias vezes.
4. Inspecionar o diff local; preservar alterações não relacionadas.
5. Delegar uma tarefa concreta por agente:
   - Forge: Android envelope/reconexão/permissões.
   - Harbor: iOS bridge/background/payload.
   - Prism: contrato multiplataforma.
   - Sentinel: testes.
6. Implementar primeiro o contrato comum em `localTransport.js` e nos dois módulos nativos.
7. Integrar mensagens e rotas em `useParty.js` e nas telas existentes, sem criar uma segunda camada de estado.
8. Executar testes mobile e servidor.
9. Gerar builds nativos; Expo Go não testa o transporte Nearby.
10. Fazer teste físico com Android e iPhone em modo avião, Bluetooth/Wi-Fi ativados:
    - descoberta;
    - autenticação;
    - localização contínua;
    - mensagem;
    - SOS;
    - envio/recebimento de rota;
    - perda e retorno do rádio;
    - app em segundo plano;
    - expiração e deduplicação.
11. Só depois revisar release, publicar no servidor e validar `/health` e `map-party.service`.

## Restrições

- Não imprimir ou versionar `.env`, tokens ou chave SSH.
- Não iniciar servidor local persistente.
- Android e iOS devem permanecer em trilhas nativas separadas.
- Não afirmar que o offline Android↔iOS está concluído sem teste físico.
- Não fazer deploy antes de testes, revisão de diff e comparação de manifestos local/remoto.
## Estado desta rodada (2026-10-09)

- Persistencia do servidor, fila offline, economia de bateria, recuperacao de renderizacao, confirmacao de restauracao e telemetria foram implementadas.
- Foi implementado `POST /api/party/:roomId/location`, autenticado por credencial assinada do dispositivo, para upload nativo quando o JavaScript estiver indisponivel.
- Android usa `LocationForegroundService` + `SharedPreferences`; iOS usa `CLLocationManager` + `UserDefaults` + `URLSession`.
- A sequencia nativa usa timestamp monotono compativel com o produtor JS, evitando rejeicao entre canais.
- Evidencia atual: 91 testes mobile, 76 testes servidor, bundle JS iOS e `assembleRelease` Android aprovados.
- O checkpoint do servidor agora serializa gravações concorrentes do timer e do desligamento; há teste de restauração do snapshot mais novo.
- Corrigido o upload nativo iOS para usar `lat`/`lng`, exatamente como o contrato REST; o teste de transporte agora impede o retorno acidental a `latitude`/`longitude`.
- O transporte Nearby agora atualiza a identidade nativa depois que o servidor atribui o `participantId`; a descoberta não fica presa ao nome exibido.
- O APK Android foi recompilado com essas alterações; SHA-256: `EE34F921CE6C2ABB331BB485E4529E53DB732EE69E8B199F2E35D4B5511B37A3`.
- A configuração de upload agora resolve `MapPartyLocation` tanto pela ponte React Native quanto pelo registro Expo Modules, cobrindo o caminho nativo iOS.
- O evento de GPS iOS e o payload REST foram separados: a interface recebe `latitude/longitude`, enquanto o servidor recebe `lat/lng`; ambos os contratos têm cobertura no teste nativo.
- A credencial de upload nativo foi retirada das preferências comuns: Android usa Keystore/AES-GCM, iOS usa Keychain, e ambos migram o valor legado uma única vez.
- O APK Android recompilado após a proteção e o remount de recuperação tem SHA-256 `6461DFDE87E8F7898721FFEFF7D64F7462FBC30082B0C89B646DA34B527B43FA`.
- A persistência do servidor mantém um backup `.bak` e restaura automaticamente dele quando o arquivo principal está corrompido; o cenário tem teste dedicado.
- Ainda falta teste fisico Android-IOS/Nearby, teste de payload proximo de 16 KB e compilacao IPA em runner macOS; nao declarar o offline radio concluido antes desses testes.
- O workflow macOS `37968185432` terminou com sucesso no GitHub para o `HEAD` `6d27b83d41d4d9686c0de60d86db605b1a097680` e publicou `map-party-ios-unsigned-ipa`; o artefato e unsigned e foi baixado para `mobile/dist-ios-artifact-37968185432/`. Como existem alteracoes locais nao commitadas, esse IPA nao prova a compilacao dessas alteracoes locais.

### Mapeamento de erros e lacunas dos novos artefatos (09/10/2026)

- APK release local existe em `mobile/android/app/build/outputs/apk/release/app-release.apk` (129.211.774 bytes, gravado em 09/10 às 17:27). APK debug também existe. O bundle Android Expo em `mobile/dist-android-final/` é de 24/09 e está desatualizado; não confundir esse export com o APK release mais recente.
- IPA unsigned baixado em `.tmp-ios-run118-attempt3-artifact/` (16.366.060 bytes, 09/10 às 18:35) é mais recente que o IPA da execução `37968185432` (16.366.060 bytes no diretório `mobile/dist-ios-artifact-37968185432/`). O nome local da tentativa não fornece prova suficiente do commit/árvore de origem; ainda não afirmar que contém as alterações locais estruturais.
- Tentativa de 08/10, diagnóstico local `.tmp-ios-diagnostics-37799303334/xcodebuild.log`: Xcode 26.6 chegou à compilação Swift e falhou em `MapPartySiriIntents.swift:70:5`, porque passou `[AppShortcut]` onde se esperava `AppShortcut`. É uma falha de fonte do build daquela revisão, não falha de runner. Há IPA posterior em 09/10, portanto verificar seu run/commit antes de reabrir essa correção.
- O workflow iOS compila o checkout do GitHub (`actions/checkout`) em `macos-26`; ele não recebe as modificações locais não commitadas. Para gerar um artefato reproduzível da revisão atual, é preciso registrar/publicar a revisão no Git e então associar o IPA ao SHA do run. Não publicar produção como parte deste gate.
- Ambos artefatos móveis disponíveis são de teste: o IPA do workflow explicitamente não tem assinatura; o APK é release local, mas ainda falta evidência registrada de SHA, origem exata do build e instalação/aceite com o iPhone e Android usados no teste.
- Lacunas restantes do gate: associar cada binário ao SHA e à revisão-fonte; comparar datas/hashes do APK e IPA com fontes locais; validar instalação/assinatura e inicialização em aparelhos; confirmar Nearby Android↔iOS, transporte em background e payload perto de 16 KB. A compilação bem-sucedida, isoladamente, não cobre esses testes físicos.

### Ícone do app e novo APK Android (09/10/2026)

- Integrado `icone/icon_1024.png` como `mobile/assets/eagle-app-icon.png` e a camada transparente como `mobile/assets/eagle-app-icon-foreground.png`; `mobile/app.json` agora usa a arte nova no ícone geral e na camada Android. O marcador `eagle-marker-native.png` e os marcadores de navegação não foram alterados.
- Atualizados os recursos nativos Android mipmap e adaptativos. A camada do mascote recebe inset de 16% para respeitar a máscara circular/adaptativa. Removidos os `ic_launcher*.webp` antigos que colidiam com os PNGs novos no merge de recursos.
- Primeiro build falhou em `configureCMakeRelWithDebInfo[x86]` usando JDK 25 (método Java restrito). A tentativa seguinte de ARM encontrou os nomes duplicados PNG/WebP; após substituir apenas os ícones antigos, o build ARM concluiu.
- `mobile/android/app/build/outputs/apk/release/app-release.apk`: 67.938.054 bytes, SHA-256 `68EC85EB54347F1837AF7022884324A6D3202BC4D652F42EAB81300DB12F8E32`; variante `release`, versão `1.0.0`, `applicationId` `com.arthur.mapparty`. Foi construído com `-PreactNativeArchitectures=armeabi-v7a,arm64-v8a`, adequado a aparelhos físicos ARM.
- O Gradle configura release com `signingConfigs.debug`; este APK serve para instalação de teste e não é um APK de distribuição assinado para produção. Ainda não foi instalado nem validado em aparelho nesta etapa.
- A trilha iOS segue separada: `expo.icon` já aponta à arte nova para o próximo prebuild iOS, mas IPA ainda precisa ser gerado e associado ao commit atual.
