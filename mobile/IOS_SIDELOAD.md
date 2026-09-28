# iOS nativo: IPA de teste por sideload

O projeto não usa o EAS para assinar o IPA de teste. O fluxo existente está em
`.github/workflows/ios-unsigned-ipa.yml` e não acessa a conta Apple:

1. O GitHub Actions usa um runner macOS.
2. `expo prebuild --platform ios` gera o projeto Xcode nativo.
3. O workflow valida o autolinking do módulo `MapPartyLocalTransport` e as permissões iOS.
4. `xcodebuild` compila o app para `iphoneos` com `CODE_SIGNING_ALLOWED=NO`.
5. O `.app` é empacotado como `map-party-ios-unsigned.ipa`.
6. O artefato fica disponível no GitHub Actions por 7 dias (`retention-days: 7`).

Depois de baixar o IPA, ele deve ser assinado e instalado localmente com uma
Personal Team gratuita (validade de 7 dias), usando Xcode em um Mac ou uma
ferramenta de sideload compatível no Windows, como Sideloadly/AltStore.

Esse IPA é um build nativo completo, não Expo Go e não `dist-ios/`. A bolinha
de velocidade e o restante do código compartilhado entram no bundle compilado.
