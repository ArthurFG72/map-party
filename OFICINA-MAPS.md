# Oficina MAPS

## Objetivo

Desenvolver e estabilizar os clientes nativos Android e iOS com a mesma
interface e os mesmos contratos de produto, usando as APIs de cada sistema
operacional sem expor essa diferença ao usuário.

## Limites dos ambientes

- **Oficina local:** código, testes finitos, builds e análise. Não manter
  servidor de desenvolvimento ou worker contínuo em execução.
- **AWS:** único ambiente de execução contínua 24x7. Serviço: `map-party.service`.
- **Produção:** `https://18-228-44-32.sslip.io`; mudanças só entram após release
  autorizada, hashes comparados e validação de `/health`.
- **Segredos:** apenas no ambiente remoto documentado; nunca em commits, logs ou
  relatórios.

## Papéis

| Papel | Responsabilidade | Entrega mínima |
|---|---|---|
| Atlas — Arquiteto GIS | mapas, rotas, contratos geoespaciais | decisão técnica e limites |
| Forge — Android nativo | APIs Android, hardware, versões e energia | diff pequeno + teste |
| Harbor — iOS nativo | APIs iOS, permissões, energia e conectividade | diff pequeno + teste |
| Prism — Compatibilidade | matriz de versões, hardware e degradação | matriz + regressão |
| Web Support — Full-stack | contratos web/servidor compartilhados | implementação |
| Deploy Support — Executor | testes e evidências reproduzíveis | relatório de testes |
| Sentinel — QA | revisão funcional, segurança e aceite | parecer QA |
| Crivo — Alternativas | revisão de decisões e riscos | recomendação |
| Anchor — Confiabilidade | preflight, manifests, systemd e rollback | gate de release |

## Ordem de trabalho

1. Reproduzir o erro com um teste mínimo.
2. Identificar o contrato compartilhado afetado.
3. Corrigir no ponto comum, evitando correções duplicadas por plataforma.
4. Validar servidor, Android e iOS separadamente.
5. Testar degradação: pouca memória, rede lenta/offline, GPS impreciso e
   versões antigas suportadas.
6. Revisar diff, gerar manifestos e comparar hashes com o destino remoto.
7. Publicar apenas com autorização explícita.
8. Validar serviço, `/health`, funcionalidade alterada e rollback.

## Separação obrigatória de plataformas

- Android e iOS têm builds, permissões, APIs nativas, assinaturas, artefatos e
  aceites físicos independentes.
- Forge trabalha somente no Android nativo; Harbor trabalha somente no iOS
  nativo. Código compartilhado só muda quando o contrato comum estiver definido.
- Nunca validar uma alteração Android usando somente export iOS, nem validar uma
  alteração iOS usando somente APK.
- APK/AAB e IPA/TestFlight são releases distintas. A release conjunta só pode
  ser criada depois dos dois gates nativos e do teste de comunicação entre as
  plataformas.

## Gates obrigatórios

- `npm test` (servidor)
- `npm run build` (cliente web)
- `npm test -w mobile` (contratos compartilhados/mobile)
- `bash -n .deploy/configure-server.sh`
- `git diff --check`
- aceite físico Android/iOS quando a alteração usar GPS, permissões, segundo
  plano, voz, mapas, rede ou recursos nativos

Falha de provedor externo é registrada como dependência; não é mascarada por
build de aplicativo. Alterações locais não relacionadas permanecem intactas.

## Economia de tokens

- Limites padrão: auditoria 600 palavras; implementação 1000; revisão 500;
  testes 300; decisão Premium 400 e uma pergunta única.
- Um prompt deve pedir somente a saída necessária, com contexto mínimo e
  arquivos delimitados.
- Relatórios usam achados, evidências, bloqueios e próximo passo; logs completos
  e contexto repetido ficam fora da resposta.
