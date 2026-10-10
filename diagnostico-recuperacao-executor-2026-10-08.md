# Diagnóstico de recuperação do executor — 2026-10-08

- `maestri list`: OK. Agentes esperados conectados: Atlas, Web Support, Crivo, Deploy Support, Sentinel, Forge, Harbor, Prism e Anchor.
- `Write-Output executor-ok`: OK.
- `RECUPERACAO-OFICINA.md` e a nota `oficina-recuperacao-maps`: lidos.
- O executor padrão apresentou `helper_unknown_error: setup refresh had errors`; por isso foram usados somente comandos finitos autorizados.
- Consulta de serviços/processos: nenhum serviço ou processo identificado como executor, Maestri ou `map-party` foi encontrado.
- Nenhum servidor local persistente ou processo em segundo plano foi iniciado.
- `git status --short` e `git log -1 --oneline` foram executados; alterações não relacionadas foram preservadas.

Conclusão: diagnóstico concluído; não há reinício necessário. A sessão pode prosseguir somente com comandos finitos autorizados até que o executor padrão se recupere.

## Causa raiz confirmada — 2026-10-08

- Sessões CUA acumuladas mantinham `node_repl.exe` aberto no runtime `cua_node`.
- O setup do sandbox falhava ao atualizar a ACL desse executável com `os error 32` (arquivo em uso).
- Como consequência, a cópia do `codex-command-runner` para `.sandbox-bin` falhava e o Codex caía para o runner legado `0.153.4`.
- Correção aplicada: encerrados somente os processos `node.exe`/`node_repl.exe` cujo executável pertencia ao runtime CUA; o setup foi executado novamente.
- Verificação: `codex-command-runner-0.162.0.exe` foi copiado para `.sandbox-bin`; duas execuções padrão do executor passaram.

Prevenção: encerrar/liberar sessões CUA quando não estiverem em uso. Não é necessário fechar o Maestri; o problema é o runtime CUA órfão. Se reaparecer, limpar apenas os processos do caminho `...\runtimes\cua_node\` e repetir uma execução finita de validação.
