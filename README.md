# Map Party

MVP de mapa compartilhado em tempo real. Uma pessoa cria uma party, envia o link e todos na sala veem posições e a mesma rota. Não há cadastro, banco de dados ou histórico: o estado vive apenas na memória do servidor e salas vazias são apagadas.

## Tecnologias e arquitetura

- `client/`: React + Vite + Tailwind CSS + React Leaflet, PWA com app shell.
- `server/`: Node.js + Express + Socket.io, rooms e participantes em memória.
- O aplicativo nativo usa `react-native-maps`; no Expo Go para iPhone, o mapa-base é fornecido pelo Apple Maps sem exigir chave.
- O backend consulta o Nominatim para busca de endereços, o OSRM para rotas de carro e o Overpass para restaurantes e postos cadastrados no OpenStreetMap, todos sem chave.

O cliente emite `join-party`, `send-location` e `update-route` com ACK e timeout. O servidor determina a sala e a identidade pelo socket conectado, valida todos os dados e publica `participants-snapshot`, `participant-location` e `route-updated`. Cada rota recebe revisão, horário e autor definidos pelo servidor. No `disconnect`, remove o participante e, se necessário, a sala. Repetir o join na mesma sala é idempotente; trocar de sala também atualiza quem ficou na sala anterior.

As consultas externas passam pelo backend em `/api/geocode`, `/api/route` e `/api/pois`. Isso centraliza timeout, validação, CORS e limites de uso, evita dependência direta do navegador nos provedores e permite configurar instâncias próprias. A geocodificação usa cache TTL/LRU e respeita um intervalo global mínimo de um segundo entre chamadas ao Nominatim. Os POIs usam cache de cinco minutos, limite de área e no máximo 200 resultados por consulta.

Cada party aceita no máximo 50 sockets. Há limites simples por socket de 30 localizações e 10 rotas por minuto, além de limite de 2.000 coordenadas por geometria e 128 KB por mensagem Socket.io (o cliente recusa rotas acima de 120 KB para reservar a sobrecarga do protocolo). Esses controles reduzem abuso acidental, mas não substituem autenticação ou infraestrutura de produção.

O service worker guarda somente o app shell (`html`, `js`, `css` e `svg`). Tiles, respostas de geocodificação/rota, Socket.io e localizações não são armazenados. O app abre offline após a primeira visita, mas informa que mapa, localização compartilhada, busca e rotas ao vivo exigem rede.

## Requisitos e execução

- Node.js 22.13 ou mais recente para o aplicativo Expo SDK 57.
- Nenhuma chave de API, conta ou cartão.

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`. O frontend usa `http://localhost:3001` por padrão. Para alterar endereços, copie `.env.example` para `.env` na raiz; tanto o Vite quanto o servidor leem essa configuração.

Outros comandos:

```bash
npm test       # testes de validação e integração Socket.io
npm run build  # build de produção/PWA em client/dist
npm start      # servidor; também serve client/dist quando o build já existe
npm run iphone # gera a PWA e serve frontend + backend em http://localhost:3001
npm run mobile # inicia o aplicativo nativo com Expo/React Native
npm run mobile:check # gera e valida o bundle iOS
```

## Aplicativo nativo para iPhone

O diretório `mobile/` contém um aplicativo React Native independente — ele não usa navegador nem WebView. No Expo Go para iPhone, o mapa é renderizado nativamente pelo Apple Maps através de `react-native-maps`, a posição vem do GPS via `expo-location` e a sincronização reutiliza o servidor Socket.io deste projeto. O aplicativo usa Expo SDK 57.

Para testar no iPhone:

1. Instale ou atualize o **Expo Go** no iPhone.
2. Conecte o computador e o iPhone à mesma rede Wi-Fi.
3. Em um terminal, execute `npm start` para iniciar o servidor na porta `3001`.
4. Em outro terminal, execute `npm run mobile`.
5. Leia o QR Code com a câmera do iPhone e abra no Expo Go.

O aplicativo descobre automaticamente o IP do computador usado pelo Metro e conecta o backend na porta `3001`. Se a rede exigir outro endereço, copie `mobile/.env.example` para `mobile/.env`, ajuste `EXPO_PUBLIC_SERVER_URL` e reinicie o Expo.

O protótipo permite criar ou entrar em uma party, compartilhar o código, acompanhar participantes, enviar o GPS, selecionar origem/destino no mapa nativo, pesquisar endereços e sincronizar a rota. Ao aproximar o mapa, os filtros **Restaurantes** e **Postos** carregam POIs da área visível. Tocar em um marcador abre ações para usá-lo como origem ou traçar uma rota até ele. O rastreamento ocorre somente enquanto o aplicativo está aberto.

O Expo Go usa Apple Maps como mapa-base no iPhone. Isso mantém o teste gratuito e sem configuração de chave, mas essa camada específica é proprietária. O código do Map Party permanece MIT e busca/rotas continuam usando OpenStreetMap, Nominatim e OSRM.

Para gerar posteriormente um aplicativo próprio para TestFlight/App Store, use o perfil de build presente em `mobile/eas.json`. Essa etapa exige uma conta Expo e credenciais Apple.

O código deste projeto é distribuído sob a licença MIT, presente em `LICENSE`. Os dados do OpenStreetMap continuam sujeitos à ODbL e exigem atribuição.

## Versão web instalável

O projeto pode ser instalado como aplicativo pela Tela de Início, sem App Store. Execute `npm run iphone`, publique a porta `3001` por uma URL HTTPS e abra essa URL no Safari do iPhone. No Safari, use **Compartilhar → Adicionar à Tela de Início**. Ao abrir pelo novo ícone, o app roda em modo standalone e usa a folha nativa de compartilhamento do iOS.

HTTPS é obrigatório para a geolocalização em um iPhone físico. Um endereço `http://IP-DO-PC:3001` pode carregar a interface pela rede local, mas não terá acesso confiável à localização. Para um teste fora do computador, use um proxy reverso ou túnel HTTPS e mantenha frontend, API e Socket.io na mesma origem.

Esta versão permanece disponível como alternativa, mas não é o aplicativo React Native presente em `mobile/`.

### Modo offline no Expo Go

O aplicativo guarda a última party, rota, pontos e posição em SQLite. Sem conexão, o GPS continua funcionando e as posições recebidas anteriormente são projetadas por velocidade/rumo, marcadas como estimadas e com opacidade reduzida. A última localização é enfileirada para sincronizar quando a conexão voltar. Uma rota nova, busca, POIs e atualizações de outras pessoas ainda precisam de rede; mapa-base e recálculo completo offline exigem um build nativo próprio.

### Backend público para teste entre redes

O arquivo `render.yaml` configura o backend como Web Service gratuito no Render. Depois de conectar este repositório ao Render e concluir o deploy, copie a URL `https://...onrender.com` para `mobile/.env`:

```bash
EXPO_PUBLIC_SERVER_URL=https://map-party-api.onrender.com
```

Reinicie o Expo Go após alterar essa variável. O plano gratuito suporta Socket.io/WebSocket, mas pode suspender o serviço após 15 minutos sem tráfego e reiniciá-lo em aproximadamente um minuto.

## Uso

1. Na página inicial, informe seu nome e crie a party.
2. Permita o acesso à localização.
3. Copie o link na lateral e envie às outras pessoas.
4. Para criar uma rota, busque os endereços de origem e destino ou use os botões **Origem** e **Destino** para marcar o mapa. A rota calculada, seus totais e o nome de quem a atualizou são sincronizados com toda a sala.

O identificador da party contém 128 bits aleatórios. Mesmo assim, **quem possui o link pode entrar na sala**: trate-o como um convite e não o publique sem necessidade. Não existe autenticação neste MVP. Ao buscar ou calcular uma rota, termos e coordenadas são encaminhados pelo backend aos serviços configurados; não use pontos sensíveis se isso for uma preocupação.

### Simular duas pessoas no mesmo computador

Abra o link da party em uma janela normal e em uma janela anônima, ou em dois navegadores. Use nomes diferentes. As DevTools do navegador permitem simular coordenadas distintas em cada janela.

### Testar em dois computadores ou celulares

Ambos precisam alcançar os endereços configurados do frontend e do servidor. Ajuste `VITE_SERVER_URL` para o host público/LAN correto e `CLIENT_ORIGIN` para a origem do frontend. Fora de `localhost`, navegadores normalmente só liberam `navigator.geolocation` em contexto seguro **HTTPS**; portanto, publique frontend e Socket.io com HTTPS/WSS (um proxy reverso ou túnel HTTPS serve para teste). Abrir apenas `http://IP-DA-MAQUINA:5173` no celular pode carregar a página, mas a geolocalização será bloqueada.

Os endpoints públicos do Nominatim, OSRM e Overpass são apropriados para demonstração e uso leve; respeite as políticas e a disponibilidade dos serviços e não os trate como infraestrutura com SLA. O aplicativo consulta o Nominatim somente quando a busca é enviada, pois sua instância pública não permite autocomplete. Em produção, configure `GEOCODER_USER_AGENT` e `OVERPASS_USER_AGENT` com um contato identificável e considere instâncias próprias por meio de `GEOCODER_BASE_URL`, `OSRM_BASE_URL` e `OVERPASS_BASE_URL`.

## Estrutura

```text
.
├── client/
│   ├── public/icon.svg
│   ├── src/components, hooks, lib, pages
│   └── vite.config.js
├── mobile/
│   ├── App.js, app.json e eas.json
│   └── src/screens, hooks, api.js e config.js
├── server/
│   ├── src/app.js, socket.js, partyStore.js, validation.js
│   ├── src/routes/ e src/services/
│   └── test/
├── .env.example
└── package.json
```
