# Gates de release para rotas

Estas verificações são obrigatórias antes de publicar novas versões do MAPS:

- Alterações em `server/src/services/routeService.js` devem ter testes para `geometry`, `legs` e `steps`.
- Deve existir um teste para endereços/POIs cujo pino seja deslocado pelo provedor até a via acessível.
- Executar `npm test` no servidor antes da publicação.
- Executar um POST real controlado em `/api/route` e confirmar pelo menos dois pontos, um trecho e uma manobra.
- Não compilar IPA/APK para mascarar falha de servidor; o servidor é aprovado primeiro.
- Falhas do Actions sem `runner_name`, sem passos executados e sem logs são classificadas como provisionamento de runner.
- Não alterar seleção de rota e tráfego na mesma release sem comparação com a rota base do OSRM.
- Após publicar, comparar hashes, validar `/health`, `map-party.service` e uma rota real.
