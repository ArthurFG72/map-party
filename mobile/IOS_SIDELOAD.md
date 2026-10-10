# iOS nativo: IPA de teste por sideload

O projeto não usa o EAS para assinar o IPA de teste. O fluxo existente está em
`.github/workflows/ios-unsigned-ipa.yml` e não acessa a conta Apple:

1. O GitHub Actions usa um runner macOS.
2. `expo prebuild --platform ios` gera o projeto Xcode nativo.
3. O workflow valida o autolinking do módulo `MapPartyLocalTransport` e as permissões iOS.
4. `xcodebuild` compila o app para `iphoneos` com `CODE_SIGNING_ALLOWED=NO`.
5. O `.app` é empacotado como `map-party-ios-unsigned.ipa`.
6. O artefato fica disponível no GitHub Actions por 7 dias (`retention-days: 7`).

## Instalação de teste

O IPA baixado é deliberadamente **unsigned**. "Build concluído" confirma que o
código compilou e foi empacotado; não confirma que o app está pronto para ser
instalado diretamente no iPhone. O arquivo correto para iniciar o teste é o
artefato `map-party-ios-unsigned-ipa` do workflow.

Este pacote continua unsigned: não o importe em um fluxo de sideload que assine
o app, nem forneça credenciais Apple. A inspeção do arquivo deve confirmar que
não há `embedded.mobileprovision` nem `CodeResources` de assinatura.

Limite do iOS: um iPhone sem jailbreak ou mecanismo especial de instalação não
instala/abre um app realmente unsigned. A Apple exige código assinado e perfil
de provisionamento para execução em aparelho físico. Portanto este workflow
gera o IPA unsigned solicitado, mas não afirma que ele possa ser instalado em
um iPhone convencional sem assinatura. Não habilite assinatura de teste ou de
distribuição sem uma nova solicitação explícita; a assinatura de distribuição
continua reservada para depois da aprovação total.

Esse IPA é um build nativo completo, não Expo Go e não `dist-ios/`. A bolinha
de velocidade e o restante do código compartilhado entram no bundle compilado.
