# Checklist de aceite do navegador

Legenda: `[x]` implementado e coberto por teste automatizado; `[ ]` pendente;
`[~]` implementação parcial, ainda sem aceite físico.

## Núcleo do dispositivo

- [x] GPS continua independente da conexão do socket.
- [x] Máquina de estados preserva `NAVIGATING` quando a conexão fica offline.
- [x] Corredor de rota limitado por tamanho para aparelhos de baixo recurso.
- [x] Grafo local validado e roteamento determinístico sem fallback de rede.
- [~] Persistência do pacote de grafo no SQLite; falta salvar/carregar o pacote
  completo (rota, corredor e grafo) na tela de navegação.
- [ ] Geração de grafos reais por corredor a partir do OpenStreetMap.
- [ ] Renderização de mapa offline no Android e iOS.
- [~] Orientações visuais pela geometria existente; síntese de voz ainda não está
  conectada a uma API nativa.
- [ ] Reconhecimento de voz local/online com degradação segura para texto.
- [ ] Recalcular a partir do pacote real de corredor no aparelho.

## Comandos e segurança

- [x] Esquema de comandos permite somente a API de navegação definida.
- [x] Cancelar, pausar, retomar, posição e estado podem ser executados localmente.
- [x] Comandos de destino não são executados como efeito direto de IA.
- [x] `device_id` estável e validado no aplicativo e no handshake do socket.
- [ ] Credencial de dispositivo assinada, expiração, renovação e autorização por
  usuário/dispositivo.
- [ ] Roteador de comandos autenticado HTTPS/WSS para dispositivo alvo.
- [ ] Adaptador de IA intercambiável e validação no servidor.
- [ ] Servidor MCP opcional sobre a mesma API validada.

## Serviço e operação

- [x] API HTTPS/WSS existente e serviço público com health check.
- [x] Rate limit e validação de payload nos endpoints atuais.
- [x] Dados OSM do Brasil baixados localmente, checksum oficial validado e
  excluídos de Git/deploy.
- [ ] Pipeline reproduzível que transforma o OSM em pacotes pequenos para cada
  rota; o grafo nacional nunca deve ser enviado ao telefone ou ao servidor web.
- [ ] Release móvel novo, identificado e instalado nos dois sistemas.

## Atualizacao de verificacao local

- Contrato de comando independente do provedor de IA implementado em
  `/api/navigation/commands`, com autenticacao e validacao no servidor.
- Pacote offline de rota gerado e persistido em SQLite, com corredor, tiles e
  grafo leve derivado da rota; o recálculo local usa esse pacote sem conexao.
- Evidencias: 47 testes do servidor, 52 testes mobile, build web e exports
  Android/iOS aprovados.
- Pendentes: grafo OSM real por corredor, aceite fisico e cenarios reais de
  hardware/rede sem aparelho conectado.

## Auditoria atualizada (2026-09-24)

- O grafo OSM real por corredor agora esta implementado em
  `server/src/services/offlineGraphService.js`, exposto em
  `/api/offline/graph` e consumido pelo mobile antes de salvar o pacote.
- O corredor e limitado por rota, raio, quantidade de pontos, nos e arestas;
  falha do Overpass mantem o fallback local leve ja existente.
- Evidencia nova: 47 testes do servidor e 51 testes do mobile passaram; build
  web e export iOS passaram apos a integracao. O endpoint foi testado com
  servico injetado e o parser OSM foi testado com resposta sintetica.
- O servico real do Overpass foi consultado em corredor minimo autorizado e
  retornou `osm-overpass` com 270 nos e 288 arestas; isso valida o caminho do
  provedor, mas nao substitui o aceite fisico do mapa no aparelho.
- Permanecem sem aceite: instalacao e teste em Android/iOS fisicos,
  cenarios de modo aviao/GPS/rede, release no servidor e eventual MCP. A
  publicacao exige autorizacao explicita e comparacao de manifestos.

## Matriz de evidencias e dependencias

| Requisito | Estado | Evidencia ou dependencia |
| --- | --- | --- |
| Pacote offline limitado e persistido | comprovado | SQLite, validacao de esquema e 52 testes mobile |
| Recalculo local no corredor | comprovado em software | Grafo local, cobertura e testes; falta observar em aparelho |
| Grafo OSM por corredor | comprovado no servico | 47 testes servidor e consulta real Overpass com 270 nos/288 arestas |
| Mapa/tiles offline em Android e iOS | parcial | Codigo e exports aprovados; renderizacao real depende de aparelhos |
| Comandos neutros para ChatGPT, Siri, Gemini e outros | comprovado em software | `/api/navigation/commands`, autenticacao e validacao |
| Voz de orientacao | parcial | `expo-speech` e planejador testados; aceite de audio depende de aparelho |
| Reconhecimento de voz com fallback | pendente | Requer decisao/implementacao de API nativa ou servico externo |
| Release segura | preparada, nao publicada | Manifestos locais e script validado; exige comparacao remota e autorizacao |
| Aceite fisico Android/iOS | pendente externo | Nenhum ADB/AVD disponivel nesta sessao |
| MCP | opcional nao integrado | Nao e necessario para a API neutra atual; integrar somente se virar requisito |

## Aceite físico obrigatório

- [ ] Android de baixo recurso: rota preparada, modo avião, desvio e retomada.
- [ ] iOS: os mesmos cenários e retorno do aplicativo em segundo plano.
- [ ] AWS/IA/WebSocket indisponíveis durante navegação.
- [ ] GPS temporariamente indisponível e recuperação.
- [ ] Múltiplos dispositivos e comandos concorrentes autorizados.

Um item só muda para `[x]` com código integrado, teste automatizado aplicável e,
quando houver interação móvel/rede, evidência de teste no aparelho ou servidor.
