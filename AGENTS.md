# Regras operacionais do MAPS

## Escopo

- Trabalhe exclusivamente no diretório MAPS e em sua infraestrutura explicitamente documentada.
- Não consulte outros projetos, aliases SSH genéricos, diretórios externos ou servidores externos antes de verificar as referências locais abaixo.

## Antes de consultar infraestrutura externa

1. Leia `RUNBOOK.md` e `.deploy/configure-server.sh`.
2. Use somente o destino definido pelo projeto: `ubuntu@18-228-44-32.sslip.io`.
3. Use a identidade SSH local `C:\Users\Arthur\Downloads\NEVEGADOR-AWS.pem` com `IdentitiesOnly=yes`; jamais leia, copie, imprima ou versione o conteúdo da chave.
4. Confirme a identidade do host SSH antes da primeira conexão; não aceite nem substitua uma chave de host sem validação explícita.
5. Não use aliases SSH que não estejam documentados no MAPS.

## Implantação do MAPS

- Aplicação remota: `/opt/map-party`.
- Serviço: `map-party.service` (systemd).
- Ambiente de produção: `/etc/map-party.env`.
- Antes de publicar: revisar o diff, executar os testes relevantes e preservar alterações locais não relacionadas.
- Depois de publicar: validar `/health` e a funcionalidade modificada no servidor público.

## Segredos

- Nunca armazene, imprima ou versione chaves privadas SSH, tokens ou valores de `.env`.
- O repositório documenta o host e o usuário SSH, mas não contém uma chave privada de acesso. Use somente a identidade SSH já configurada no ambiente.
## Sincronização e execução

- O servidor é o único ambiente permitido para execução contínua 24x7. Não deixe processos de desenvolvimento, servidores locais ou tarefas em segundo plano em execução na máquina local; testes finitos são permitidos.
- Cada mudança aprovada é uma única release: aplicar localmente, executar os testes relevantes, publicar no servidor e espelhar a versão efetivamente publicada de volta no diretório local.
- Antes e depois de cada release, comparar hashes dos arquivos de aplicação entre `server/` local e `/opt/map-party/server` remoto. A release só está concluída quando os manifestos são idênticos, exceto arquivos de ambiente, dependências e artefatos explicitamente excluídos.
- Se houver divergência, não assumir qual lado é canônico: registrar os arquivos e datas divergentes, obter a direção do usuário e só então sincronizar.
- Após publicar, validar `/health`, a funcionalidade modificada e o estado `active` de `map-party.service`.
## Início de sessão e equipe

- No início de cada sessão, executar `maestri list` e confirmar que os papéis Arquitetura GIS, Implementação Full-Stack, Avaliação, QA e Testes estão conectados e saudáveis antes de delegar trabalho.
- Se um papel estiver ausente, consultar `maestri role list` e iniciar somente o agente faltante; nunca recrutar duplicatas.
- Manter os agentes conectados ao maestro e aos pares de revisão necessários, porém o trabalho só começa quando uma tarefa concreta for atribuída.

## Recuperação após queda

- O ponto de entrada é `RECUPERACAO-OFICINA.md` e a nota Maestri
  `oficina-recuperacao-maps`.
- Depois de uma queda, executar `maestri list`, confirmar os papéis e testar o
  executor com `Write-Output executor-ok` antes de ler ou alterar o projeto.
- Se o executor padrão falhar com `helper_unknown_error: setup refresh had
  errors`, registrar a falha e usar somente o modo autorizado para comandos
  finitos; nunca iniciar servidor local persistente para contornar o problema.
- Delegar uma etapa por vez, com dono único e saída curta. Não recrutar agente
  duplicado nem repetir contexto já registrado.
- Manter Android e iOS em trilhas separadas: builds, permissões, APIs nativas,
  assinaturas, testes físicos e artefatos não podem ser tratados como
  intercambiáveis. A integração entre eles ocorre somente pelo contrato comum.
