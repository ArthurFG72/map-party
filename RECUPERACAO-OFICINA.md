# Recuperação da oficina MAPS

Este arquivo é o ponto de entrada quando a sessão, o executor ou um agente
for reiniciado. A nota Maestri `oficina-recuperacao-maps` contém a mesma regra
para os agentes conectados.

## Checklist de retomada

1. Executar `maestri list`.
2. Confirmar os papéis: Atlas, Web Support, Crivo, Deploy Support, Sentinel,
   Forge, Harbor, Prism e Anchor. Não recrutar duplicatas.
3. Ler `RUNBOOK.md`, `.deploy/configure-server.sh`, `OFICINA-MAPS.md` e este
   arquivo.
4. Testar o executor com `Write-Output executor-ok`, depois `git status --short`
   e `git log -1 --oneline`.
5. Se aparecer `helper_unknown_error: setup refresh had errors`, parar mudanças
   e publicação. Registrar o erro e usar somente o executor autorizado para
   diagnóstico finito; não deixar serviços locais em segundo plano.
6. Retomar da última evidência confirmada, preservando alterações locais.

## Blindagem do executor

Antes de uma nova etapa, executar o preflight finito:

```powershell
.\scripts\executor-preflight.ps1
Write-Output executor-ok
```

Se ele detectar processos CUA sem uso, fechar a sessão CUA correspondente. Como
último recurso, usar `-CleanStaleCua` para encerrar somente `node.exe` e
`node_repl.exe` cujo executável esteja dentro de `runtimes\cua_node` e então
repetir `Write-Output executor-ok`. Nunca encerrar processos Node fora desse
caminho.

## Economia de tokens

- Um dono por tarefa; nenhuma execução concorrente na mesma etapa.
- Delegação fechada: objetivo, área, proibições, saída e critério de parada.
- Leitura localizada e diffs mínimos; não repetir contexto já documentado.
- Respostas dos agentes: achados, evidência, bloqueio e próximo passo.
- Claude Premium só para decisões críticas. Nunca enviar segredos.
- Limites padrão de saída: auditoria 600 palavras; implementação 1000;
  revisão 500; testes 300; decisão Premium 400 e uma pergunta única.
- Enviar somente trechos de log que sustentem o achado. Não repetir contexto ou
  despejar logs completos sem necessidade.

## Ordem segura

Reproduzir → localizar contrato comum → corrigir → testar servidor/mobile/web →
revisar com Crivo/Sentinel → validar com Deploy Support → comparar manifests e
hashes → pedir autorização → publicar → validar serviço, `/health` e rollback.

## Regra Android/iOS

Android e iOS são trilhas independentes. Cada trilha deve ter seu próprio build,
permissões, APIs nativas, assinatura, testes físicos e artefato de distribuição.
O contrato compartilhado é revisado separadamente; APK não substitui IPA e
export iOS não substitui teste Android. Só unir as releases depois que ambas as
trilhas passarem e a comunicação Android↔iOS for validada.
