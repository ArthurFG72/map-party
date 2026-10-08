# MAPS — preflight de release

Atualizado em 2026-09-24. Este arquivo registra somente evidências locais; não
autoriza publicação.

## Verificações aprovadas

- `npm test --silent`: 47 testes do servidor aprovados.
- `npm test -w mobile --silent`: 52 testes mobile aprovados.
- `npm run build`: build web aprovado.
- `npm run check -w mobile --silent`: export iOS aprovado.
- `npx expo export --platform android --output-dir <temporario>`: export Android aprovado.
- `git diff --check`: sem erro de whitespace; avisos de conversão LF/CRLF apenas.
- `bash -n .deploy/configure-server.sh`: sintaxe aprovada.
- Overpass real: corredor mínimo retornou 270 nós e 288 arestas.
- Manifesto local: mobile 99 arquivos; servidor 34 arquivos.

## Gates ainda necessários

1. Revisar o diff completo preservando alterações locais não relacionadas.
2. Gerar manifestos do release efetivo e enviar somente para staging remoto.
3. Comparar hashes local/staging antes da promoção atômica.
4. Publicar somente após autorização explícita.
5. Validar `map-party.service`, `/health` e a funcionalidade modificada após a publicação.
6. Executar aceite físico em Android e iOS, incluindo modo avião, GPS, tiles,
   recálculo, segundo plano e múltiplos dispositivos.

Sem aparelho conectado nesta sessão (`adb devices` sem dispositivos e sem AVD),
os gates físicos permanecem pendentes.

## Release executada (2026-09-24)

- Server `release-a66263bae495302a` foi promovido para `/opt/map-party/server`;
  a versão anterior foi preservada em `/opt/map-party/backups/`.
- `DEVICE_AUTH_SECRET` de produção foi criado/garantido sem expor seu valor;
  `map-party.service` ficou `active` após `daemon-reload` e restart.
- `/health` público retornou `ok: true`; o manifesto pós-release do servidor
  permaneceu igual ao local.
- O endpoint `/api/offline/graph` chegou à aplicação, mas o Overpass remoto
  respondeu `PROVIDER_ERROR`; isso foi registrado como dependência externa,
  enquanto o teste real do Overpass local já havia sido aprovado.
- O espelho Expo Go `release-go-391f8f0933fafb1f` foi promovido para
  `/opt/map-party/mobile`, com manifesto 99/99 igual ao local.
- Para iOS/Expo Go, usar `npm run start:go:ios -w mobile` em LAN ou
  `npm run start:go:tunnel -w mobile` quando a rede local bloquear a descoberta.
- Após o erro de entrada no Expo Go, o Socket.io público foi testado diretamente
  com contrato `1`, `participantToken` e `deviceId`: `joinOk: true`.
- O espelho mobile foi atualizado novamente para `release-go-6d24ce9c16ed5b8b`,
  com `--clear` nos comandos Expo Go para evitar bundle antigo em cache.
- `/health` público continuou `ok: true` após essa atualização; a entrada da
  party deve usar o servidor público, nunca um backend local.

## Publicacao Expo/EAS (iOS)

- Update publicado no branch `preview` do projeto Expo `vgalvaos-team/vgalgao`.
- Update ID: `01a0d3e6-fde1-7e0b-a03c-58e6c000d9ac`.
- Grupo: `5993bd0a-4e92-412d-b446-77649d76c498`.
- Runtime: `1.0.0`; permalink: `https://u.expo.dev/update/01a0d3e6-fde1-7e0b-a03c-58e6c000d9ac`.
- A publicação não substitui o aceite físico nem cria um backend local; o
  aplicativo continua usando `https://18-228-44-32.sslip.io`.
- Limite importante: o Expo Go não é o cliente confiável para abrir um EAS
  Update publicado. Para acesso remoto fora da oficina, usar um development
  build/TestFlight compatível com o runtime `1.0.0`; Expo Go remoto continua
  dependendo de Metro via túnel.
