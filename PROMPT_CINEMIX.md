# Prompt de desenvolvimento — Cinemix

## Papel e objetivo

Atue como uma pessoa desenvolvedora full-stack sênior, com experiência em Node.js, Express, PostgreSQL/Supabase, Socket.IO e interfaces web responsivas.

Desenvolva a aplicação **Cinemix**, uma plataforma de catálogo de filmes e séries com salas virtuais para assistir em grupo. O objetivo é entregar uma aplicação real, segura e persistente — não apenas uma demonstração visual. Formulários, botões, navegação, consultas, autenticação, salas e chat devem executar operações reais e apresentar estados de carregamento, sucesso e erro.

## Instruções de trabalho

1. Comece inspecionando o projeto existente, sua estrutura, dependências, rotas, banco, integrações e testes. Identifique o que já funciona e o que está incompleto.
2. Preserve funcionalidades e configurações existentes que estejam corretas. Não apague nem recrie o projeto do zero sem necessidade comprovada.
3. Antes de uma mudança estrutural incompatível, explique a causa, o impacto e os arquivos envolvidos.
4. Implemente em etapas, com validação depois de cada etapa. Reutilize padrões e dependências já presentes no projeto sempre que forem adequados.
5. Não invente contas, filmes disponíveis, horários, participantes, resultados de consultas, métricas ou resultados de testes. Se um serviço estiver indisponível, mostre isso claramente.
6. Não considere um recurso concluído só porque sua interface aparece. Verifique o comportamento real do servidor e do banco.
7. Não grave credenciais, tokens ou senhas em código-fonte, arquivos servidos ao navegador, logs, mensagens de erro ou histórico do Git.
8. Ao terminar, apresente um relatório com alterações, arquivos envolvidos, testes e resultados, variáveis necessárias, limitações externas e pendências.

## Aplicação e identidade visual

- Nome oficial: **Cinemix**.
- Use a logo oficial fornecida como anexo no projeto. Não a substitua por uma imagem inventada nem presuma um caminho sem confirmar onde o arquivo foi colocado.
- A logo anexada tem fundo preto, moldura circular verde neon, símbolo de play integrado a uma película de cinema e o nome “CINEMIX” em branco e verde.
- Se necessário, peça para colocar o arquivo da logo em uma pasta de assets e use o caminho confirmado no projeto.
- Identidade visual: fundo preto ou quase preto, verde neon próximo de `#00FF00`, textos brancos/cinza-claro, contraste legível e brilho discreto.
- Crie uma interface moderna de streaming, adaptável a computadores, tablets e celulares, sem exagerar nos efeitos luminosos.
- O `index`/ponto de entrada da interface deve oferecer, com navegação clara, as áreas de autenticação, catálogo, detalhes, salas e administração. Podem ser páginas ou componentes, conforme a arquitetura existente.

## Configuração e serviços

### Supabase/PostgreSQL

O projeto Supabase fornecido pelo proprietário é:

- URL do projeto: `https://kkalgrybggnqeuetbdha.supabase.co`
- Host PostgreSQL direto IPv4: `db.kkalgrybggnqeuetbdha.supabase.co`, porta `5432`, banco `postgres`, usuário `postgres`.
- A senha é fornecida separadamente pelo proprietário; represente-a somente como variável de ambiente, por exemplo:
  `DATABASE_URL=postgresql://postgres:[SENHA]@db.kkalgrybggnqeuetbdha.supabase.co:5432/postgres`
- A chave publishable do Supabase já foi fornecida. Use-a somente se a arquitetura realmente precisar de acesso público pelo SDK do Supabase. Para operações privilegiadas, autenticação e acesso direto ao PostgreSQL, prefira o servidor Node.js e mantenha credenciais privadas exclusivamente no servidor.

Antes de criar tabelas, examine o banco e procure estruturas equivalentes. Se for necessário criar ou alterar tabelas, use migrações versionadas, integridade referencial, índices pertinentes e consultas parametrizadas. O estado de contas e salas não pode depender apenas da memória do processo.

Configure o pool e o uso de TLS conforme o ambiente do Supabase/Render. Não coloque a senha real no repositório, em arquivos públicos ou em exemplos de configuração. Documente todas as variáveis necessárias em um arquivo de exemplo sem valores secretos.

### TMDb

O catálogo de filmes e séries deve usar a API do TMDb. O proprietário já forneceu uma chave v3 e um token de leitura v4. Leia a credencial escolhida de uma variável de ambiente no servidor, como `TMDB_API_KEY` ou `TMDB_ACCESS_TOKEN`; não a copie para o frontend nem para o repositório.

As credenciais foram compartilhadas em uma instrução. Recomende que sejam rotacionadas antes de publicar a aplicação e que o novo valor seja cadastrado como segredo na hospedagem.

Use a documentação e endpoints apropriados para:

- Filmes populares, em cartaz, próximos lançamentos e mais bem avaliados.
- Séries populares, no ar e mais bem avaliadas.
- Busca por título, detalhes, sinopse, gêneros, pôster, data e avaliação.
- Paginação ou carregamento progressivo.

Prefira um proxy no backend para ocultar a credencial, validar parâmetros, limitar requisições e devolver erros controlados. Nunca mostre dados inventados quando o serviço falhar; exiba uma mensagem clara e registre detalhes técnicos sem tokens.

### Hospedagem

Prepare a aplicação para execução no Render, com `PORT` e demais configurações em variáveis de ambiente. Verifique no deployment escolhido o suporte a WebSockets/Socket.IO, proxy TLS, health check e conexão persistente ao PostgreSQL. Documente o processo de implantação sem incluir segredos.

## Autenticação e contas

### Login

Na tela inicial, mostre a logo e a mensagem **“Bem-vindo ao Cinemix”**, além de campos para nome de usuário e senha, botão de entrar e acesso à criação de conta.

- O servidor deve comparar as credenciais com a conta cadastrada; conhecer um nome de usuário, sozinho, nunca autoriza o acesso.
- Armazene somente hashes de senha com Argon2id ou bcrypt e parâmetros apropriados.
- Normalize e valide nomes de usuário de forma consistente e aplique unicidade no banco para evitar cadastros duplicados, inclusive em solicitações simultâneas.
- Mostre erros de credenciais sem revelar se uma conta específica existe.
- Implemente limitação de tentativas, validação no servidor, expiração e encerramento de sessão e cookies seguros (`HttpOnly`, `Secure` em produção, `SameSite` adequado).
- Proteja operações contra CSRF quando aplicável e regenere o identificador da sessão após login e cadastro.

### Cadastro

O formulário deve solicitar nome de usuário e senha, validar os dados no cliente e obrigatoriamente repetir a validação no servidor. Se o nome já estiver ocupado, destaque o campo em vermelho e informe **“Esse nome de usuário já existe”**. Só mostre sucesso depois da confirmação da gravação pelo banco. Após o cadastro bem-sucedido, autentique a nova conta e abra o painel do cliente.

## Administrador único

Implemente um painel administrativo protegido no servidor. Deve existir no máximo uma conta administradora principal, pertencente ao proprietário.

- Não transforme `ADM 01` (ou qualquer nome de exemplo) em uma senha, credencial fixa ou prova de autorização.
- Provisione o administrador por um procedimento seguro de inicialização, com nome e senha forte definidos pelo proprietário fora do código — por exemplo, variáveis de ambiente/secret manager. Não crie uma rota pública de promoção.
- Garanta a unicidade também no banco e durante inicializações concorrentes. Se já houver um administrador, não crie outro silenciosamente.
- Todas as rotas administrativas devem validar a função no servidor; esconder controles na interface não é proteção.
- Permita pesquisar/listar contas, ver data de criação e estado, redefinir senha por hash, excluir contas com confirmação, invalidar sessões pertinentes e consultar o histórico de atividade permitido.
- Nunca revele senha antiga nem hash.
- Registre ações administrativas, cadastros, logins bem-sucedidos e falhos (com limitação), criação/encerramento de salas e erros relevantes. Não registre senhas ou tokens.
- Diferencie claramente total de contas, sessões no período e usuários simultaneamente conectados. Não apresente uma métrica como se fosse outra.

## Catálogo, pesquisa e detalhes

Depois do login, mostre a marca Cinemix e abas para **Filmes**, **Séries** e **Salas de Cinema**, além de pesquisa em tempo real ou acionada sem recarregar a página.

Cada cartão pode apresentar pôster, título, data e avaliação disponíveis. Inclua paginação/carregamento progressivo, estado de carregamento, resultados vazios e mensagens de erro.

Ao selecionar um título, abra detalhes em modal ou página responsiva contendo pôster, nome, sinopse, gêneros, data e avaliação quando fornecidos pelo TMDb. Para filmes, apresente as ações **“Assistir Filme”** e **“Criar Sala Privada”** somente conforme as capacidades reais configuradas. Para séries, não prometa reprodução se não houver fonte compatível.

## Reprodução: validar antes de prometer

Foi fornecido como candidato um iframe no formato:

`https://embedwave.cc/embed/movie/{ID_DO_TMDB}`

O ID deve ser validado como ID de filme do TMDb. Antes de usar o serviço, investigue se o domínio está acessível, se a incorporação é permitida, se a fonte é autorizada e documentada, quais restrições de origem/reprodução automática existem e se há API oficial de controle.

Um título no catálogo não significa que exista um vídeo disponível ou autorizado. Não exiba um player falso, não afirme que o filme está tocando se não estiver e não use o identificador de exemplo como solução para todo o catálogo.

Um iframe de outra origem normalmente não permite que o Cinemix leia ou controle a reprodução. Implemente sincronização de play/pausa/posição somente se o player escolhido oferecer mecanismo oficial e compatível. Se a fonte não puder ser verificada/configurada, explique a limitação, desabilite a ação de reprodução e mantenha uma mensagem informativa. Não prometa sincronização perfeita nem autoplay garantido; navegadores podem bloquear reprodução automática com som.

## Salas públicas

O sistema deve programar **42 salas públicas** (as 32 existentes e mais 10), persistidas no banco e administradas pelo servidor:

- Pelo menos **4 salas de Terror** e **3 salas de Ação**.
- Distribua as demais salas de forma equilibrada por gêneros disponíveis, como Comédia, Drama, Ficção Científica, Animação, Suspense, Aventura e outros.
- Mapeie os gêneros do TMDb de modo explícito. Use filmes encontrados no catálogo, preferencialmente populares, recentes e adequados ao gênero. Evite repetições em excesso, mas não invente títulos se houver poucos resultados.
- Identifique cada sala com número, gênero, título, horário, estado e participantes atuais.
- Planeje horários distintos no fuso horário configurado. Não atribua o mesmo horário a todas as salas nem dependa de temporizador no navegador.
- As 10 salas adicionais devem distribuir sessões entre manhã, tarde e noite, com Terror e Terror e Mistério em horários noturnos.
- A capacidade é de **42 participantes por sala** e deve ser imposta no servidor/banco com operação segura diante de entradas simultâneas.
- Mantenha a programação e os estados após atualização ou reinício. Rotinas de servidor devem iniciar sessões e encerrá-las idempotentemente sem depender do criador conectado.
- Não apresente popularidade do TMDb como contagem real de espectadores.
- Use duração fornecida pela fonte quando disponível; se estimar uma duração ausente, identifique-a como estimativa.
- Se não houver player reproduzível, informe isso na sala e não declare que o filme está tocando.

## Salas privadas

Usuários autenticados podem criar sala privada a partir do título escolhido. Solicite horário de início e senha da sala; associe automaticamente o título ao registro.

- Valide título, senha e horário futuro (com limite razoável documentado).
- Armazene a senha da sala somente como hash. Nunca a inclua em listagens, respostas públicas ou logs.
- Cada usuário pode manter no máximo **3 salas privadas ativas**. Faça a verificação e criação em transação/lock para impedir que solicitações concorrentes ultrapassem o limite.
- Uma sala encerrada/cancelada/falha deixa de contar como ativa e libera a vaga. A expiração/encerramento ocorre no servidor mesmo se o criador sair ou a hospedagem reiniciar.
- Na listagem, mostre apenas o nome público do criador, o filme, horário, estado e botão de entrada; solicite a senha ao entrar.
- Verifique senha e estado no servidor. Bloqueie senhas incorretas, salas encerradas e participantes acima da capacidade.
- Preserve histórico necessário e evite registros órfãos ao excluir uma conta.

## Chat em tempo real e experiência de sala

Implemente chat de sala pública e privada via Socket.IO ou WebSocket:

- Exija sessão autenticada e autorização de participação para entrar no canal e enviar mensagem.
- Valide tamanho e frequência no servidor; use limite documentado (por exemplo, até 500 caracteres).
- Transmita como texto simples, sem executar HTML/JavaScript enviado por usuários.
- Associe mensagem à sala, usuário e horário. Persista mensagens/histórico conforme a política definida.
- Isole mensagens entre salas e impeça envio por não participantes.
- Atualize a presença, trate reconexão e saída explícita sem confundir sair da tela cheia com sair da sala.
- Registre moderação/denúncias se fizer parte do escopo e forneça estados de erro visíveis.

No computador, permita abrir/fechar um painel lateral de chat à direita enquanto o player ocupa o espaço restante à esquerda. No celular, use painel expansível ou área própria, com controles confortáveis para toque.

Disponibilize controle de tela cheia se o navegador e o player suportarem. A tecla Esc deve apenas retirar da tela cheia, mantendo a sala e o chat abertos. Não presuma que gesto de toque funciona igualmente em todos os aparelhos.

Sincronize o estado do vídeo (play/pausa/posição) somente com player que tenha API de controle verificada. Caso contrário, ofereça chat e estado da sala sem fingir controle do vídeo. O servidor, e não o relógio local do celular, é a referência de horários.

## Modelo de dados e ciclo de vida

Verifique as tabelas existentes antes de criar novas. O modelo deve dar suporte, no mínimo, às entidades necessárias para contas, sessões autenticadas, salas, participantes, mensagens e auditoria administrativa. Inclua chaves estrangeiras, estados válidos, índices e restrições para nome único, sala única na programação, capacidade, senha privada e limite de administrador.

Estados de sala recomendados: agendada, aguardando, em reprodução (somente quando confirmado), encerrada, cancelada e com falha. O encerramento deve bloquear novas entradas, notificar participantes, liberar a cota do criador, atualizar a lista e registrar evento. Repetir a rotina não pode duplicar efeitos.

## Segurança e privacidade

Implemente proteção adequada contra injeção SQL, força bruta, roubo/falsificação de sessão, CSRF, acesso administrativo indevido, acesso não autorizado a salas privadas, manipulação de IDs, excesso de cadastros/salas/mensagens e abuso das APIs.

- Parametrize consultas e aplique autorização no servidor em cada operação protegida.
- Use validação no servidor como autoridade; validação do navegador é apenas UX.
- Restrinja permissões do banco ao necessário e configure RLS do Supabase se a arquitetura usar acesso direto pelo cliente.
- Não exponha conexão PostgreSQL, chave privada, segredo de sessão, senha administrativa ou token TMDb.
- Use headers de segurança, limite de payload e mensagens de erro sem detalhes internos.
- Não confie em estado administrativo armazenado somente no navegador.

## Testes e critérios de aceitação

Execute os testes pertinentes existentes e adicione testes automatizados adequados. Relate somente resultados realmente verificados.

Verifique, conforme ambiente e credenciais disponíveis:

- Login válido/inválido, usuário inexistente, limitação de tentativas, logout e rotas protegidas.
- Cadastro válido e duplicado, concorrência e armazenamento de hash.
- Bloqueio de operações administrativas para usuário comum; provisionamento de apenas um admin; listagem, redefinição, exclusão e auditoria.
- TMDb: filmes, séries, busca, detalhes, paginação, vazio, falhas e ausência de credencial.
- Programação com exatamente 42 salas, preservando as 32 existentes e adicionando 10, com pelo menos 4 de Terror e 3 de Ação, horários distintos e dados reais do catálogo.
- Capacidade de 42 com tentativas simultâneas, sala lotada, estados e encerramento.
- Criação de até 3 salas privadas, bloqueio da quarta, liberação após encerramento, senha correta/incorreta e ausência da senha na listagem.
- Chat entre participantes, isolamento entre salas, mensagens inválidas/abusivas, usuário não autorizado e reconexão.
- Tela cheia e comportamento responsivo em computador e celular. Não declare teste em dispositivo real se ele não foi feito.
- Reprodução e sincronização apenas após verificar player, permissões e API; registre explicitamente qualquer bloqueio externo.

Se o banco, tokens, player, rede ou ambiente de hospedagem não estiverem disponíveis, não invente resultados. Execute os testes independentes possíveis e liste o que o proprietário precisa fornecer.

## Ordem de implementação sugerida

1. Diagnóstico do projeto, integrações, banco e hospedagem.
2. Arquitetura, variáveis de ambiente e migrações.
3. Login, cadastro, sessões e proteção de rotas.
4. Provisionamento e painel do administrador.
5. Proxy TMDb, catálogo, pesquisa e detalhes.
6. Verificação do player e limites reais de reprodução.
7. Programação e capacidade das salas públicas.
8. Salas privadas e cota de três salas.
9. Chat, autorização e sincronização tecnicamente suportada.
10. Interface responsiva, logo, acessibilidade e tela cheia.
11. Testes integrados, correções e instruções de implantação.

Ajuste essa ordem somente se uma dependência técnica exigir, explicando o motivo.

## Entrega final

Ao concluir, informe:

1. O que foi inspecionado e implementado.
2. Quais arquivos foram criados/modificados e quais funcionalidades existentes foram preservadas.
3. Quais testes foram executados e seus resultados reais.
4. Variáveis de ambiente que o proprietário precisa configurar.
5. Limitações que dependem de Supabase, TMDb, Render, rede ou provedor de vídeo.
6. Pendências e próximos passos para publicar com segurança.

Não declare o sistema pronto, reproduzindo vídeos ou sincronizando players, se essas capacidades não tiverem sido verificadas de ponta a ponta.
