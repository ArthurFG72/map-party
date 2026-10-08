# Diretriz de retomada — executor do MAPS

**Registrado em:** 2026-10-08
**Status:** resolvido parcialmente; o modo autorizado funciona, mas o sandbox
padrão ainda apresenta `helper_unknown_error: setup refresh had errors`.

## Ponto em que a sessão parou

A sessão foi interrompida antes de qualquer alteração no projeto ou execução de testes. O último passo tentado foi executar comandos locais de leitura (`git status --short`, `git log -1 --oneline` e, depois, um `Write-Output` mínimo).

## Erro reproduzido

O executor falha antes de iniciar o PowerShell, inclusive para um comando mínimo:

`helper_unknown_error: setup refresh had errors`

O erro ocorreu em tentativas repetidas, com e sem login, portanto ainda não há evidência de que seja causado pelo código do MAPS.

## O que foi confirmado

- Os agentes Maestri estavam conectados e saudáveis no início da sessão.
- Nenhum arquivo do MAPS foi alterado por causa deste incidente.
- Nenhum serviço local ou remoto foi reiniciado.
- Não houve publicação nem conexão SSH.
- O runtime do executor não oferece, nesta sessão, um comando acessível para reinicialização.

## Ação obrigatória ao retomar

1. Reiniciar o runtime/sessão do executor pela interface do Codex quando o
   sandbox padrão for necessário.
2. Executar um teste mínimo no diretório `C:\Users\Arthur\Documents\MAPS`:

   `Write-Output executor-ok`

3. Se funcionar, executar `git status --short` e `git log -1 --oneline`.
4. Só então continuar qualquer tarefa do MAPS.
5. Se o erro persistir, registrar novamente o texto exato e escalar como falha do runtime, sem alterar arquivos ou infraestrutura para tentar contorná-lo.

## Critério de encerramento

Esta ocorrência só pode ser considerada resolvida quando o teste mínimo e os comandos Git forem executados com sucesso.
