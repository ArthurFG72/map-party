# Plano de desenvolvimento e validação

## Princípio de produto

O aplicativo navega de forma autônoma no dispositivo. Internet, AWS, WebSocket,
MCP e IA são integrações auxiliares: nenhuma delas pode interromper uma rota já
iniciada.

O Brasil é a área de cobertura. O aplicativo não baixa o mapa inteiro do país.
Quando uma rota é iniciada com conexão, ele prepara no aparelho um pacote offline
daquela rota: corredor da rota, margem para desvios, grafo de vias, dados de mapa,
POIs necessários e instruções de voz. Esse pacote é suficiente para continuar e
recalcular localmente se a conexão desaparecer.

## Estados obrigatórios

Conexão: `CONNECTING`, `ONLINE`, `OFFLINE`.

Navegação: `IDLE`, `NAVIGATING`, `PAUSED`, `RECALCULATING`, `ARRIVED`, `ERROR`.

Uma alteração de conexão não pode alterar a navegação de `NAVIGATING` para
`ERROR` ou `IDLE`.

## Etapas e critérios de aceite

1. **Base de release** — manifesto de fontes, pacote de release imutável,
   comparação de hashes e promoção atômica do espelho mobile. Critério: nenhuma
   publicação parcial é possível.
2. **Pacote offline por rota** — seleção de corredor, limites de tamanho,
   validação de esquema, armazenamento local e descarte controlado. Critério:
   uma rota criada online permanece disponível após reiniciar o app sem rede.
3. **Motor local** — cálculo/recalculamento no grafo local e integração ao mapa.
   Critério: desvio de rota sem rede produz nova rota local.
4. **GPS e voz** — posição, orientações e síntese de voz sem servidor. Critério:
   funcionamento contínuo em modo avião após rota preparada.
5. **Comandos locais** — iniciar, cancelar, pausar, retomar, estado e posição.
   Critério: comandos críticos não fazem chamada de rede.
6. **AWS seguro** — autenticação, dispositivo, sessão, HTTPS/WSS, reconexão e
   roteamento de comandos. Critério: dispositivo não autenticado não executa
   comandos; queda do servidor não interrompe rota.
7. **IA intercambiável** — adaptador, validação de intenção e autorização antes
   de executar. A IA só produz comandos estruturados; nunca controla GPS.
8. **MCP** — camada opcional que expõe a mesma API de comandos validada.
9. **Aceite físico** — Android e iOS, aparelho de baixo recurso e cenário atual:
   dados/Wi-Fi desligados, AWS indisponível, IA indisponível, WebSocket perdido,
   GPS temporariamente perdido, múltiplos dispositivos e comandos simultâneos.

Nenhuma etapa é concluída por teste de arquivo antigo. Cada funcionalidade exige
teste novo, build novo identificável, teste no aparelho e resultado registrado.

## Protocolo de release sem cópias parciais

1. Validar somente as fontes incluídas e gerar um manifesto SHA-256.
2. Gerar arquivo de release com a lista explícita desses arquivos.
3. Enviar o arquivo para diretório remoto de staging com o identificador do
   manifesto; nunca para o destino final.
4. Extrair no staging e comparar o manifesto remoto com o local.
5. Somente com igualdade, promover o staging para o espelho mobile por uma única
   operação no servidor.
6. Conferir novamente o manifesto efetivamente publicado, o serviço
   `map-party.service` e `/health`.

Arquivos temporários, dependências, builds, chaves, `.env`, logs e capturas não
fazem parte do espelho. Uma falha em qualquer etapa mantém a versão anterior e
gera registro; não há sincronização manual corretiva sem comparar hashes.
