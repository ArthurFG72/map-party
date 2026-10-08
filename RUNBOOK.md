# Runbook Operacional

## Fonte de verdade

- O ambiente de teste real é o servidor publico configurado em `mobile/.env` por `EXPO_PUBLIC_SERVER_URL`.
- Nesta revisao, o endpoint ativo e `https://18-228-44-32.sslip.io`.
- `render.yaml` descreve uma opcao de publicacao e nao deve substituir o endpoint ativo sem autorizacao explicita.
- Esta pasta local e desenvolvimento e recuperacao. Ela nao e uma copia publicada automaticamente.

## Regra antes de mudar

1. Conferir `git status` e preservar alteracoes existentes.
2. Confirmar o endpoint publico ativo e o alvo do teste.
3. Alterar somente os arquivos ligados ao pedido.
4. Executar os testes locais relevantes.
5. Revisar o diff antes de publicar.
6. Publicar somente com autorizacao explicita e validar no servidor publico depois.

## Protecoes

- Nunca sobrescrever `.env`, `mobile/.env`, `render.yaml` ou URLs publicas sem autorizacao explicita.
- Nunca assumir que iniciar Expo local atualiza o servidor publico.
- Nunca limpar, reverter ou sincronizar a arvore local para tentar igualar o servidor publico sem uma instrucao explicita.
- Se configuracoes publicas divergirem, parar e pedir a URL canonica antes de publicar.

## Espelho de código-fonte móvel

- /opt/map-party/mobile espelha somente o código-fonte necessário para gerar os aplicativos Android e iOS. Não é um diretório de build nem de execução contínua.
- Sincronizar mobile/ sem
ode_modules/, dist*/, .expo/, ndroid/.gradle/, ndroid/.cxx/, ndroid/build/, ndroid/app/build/, ios/build/, arquivos *.hbc, *.map, .env, logs, APK/AAB/IPA, chaves e outros artefatos gerados.
- As exclusões seguem mobile/.easignore. Antes e depois de uma release, comparar manifestos dos arquivos incluídos; divergências exigem direção explícita sobre o lado canônico.
- O servidor executa somente server/ via map-party.service; builds móveis são finitos e gerados fora do serviço, preservando CPU, memória e disco do host.

- Capturas de verificação visual (`map-party.png`, `s20-*.png`), `android/.kotlin/` e `android/app/debug.keystore` também são excluídos; recursos declarados em `mobile/assets/` e `android/app/src/main/res/` permanecem incluídos.
