# Cinemix

Aplicação web para catálogo de filmes e séries, reprodução incorporada e salas com chat em tempo real.

## Requisitos e execução local

- Node.js 20 ou superior
- PostgreSQL Neon acessível pela aplicação
- Acesso HTTPS de saída para TMDb e `pipocacine.online`

1. Copie `.env.example` para `.env` e configure `DATABASE_URL`, `SESSION_SECRET` (mínimo de 32 caracteres) e uma credencial TMDb. Não grave valores reais no repositório.
2. Opcionalmente configure `ADMIN_USERNAME` e `ADMIN_PASSWORD` juntos para provisionar a conta administrativa inicial.
3. Execute `npm install`, `npm run build`, `npm test`, `npm run migrate` e `npm start`; abra `http://localhost:3000`.

O servidor usa PostgreSQL com TLS em produção, sessões persistidas e migrações versionadas.

## Catálogo, disponibilidade e reprodução

- TMDb fornece descoberta, pesquisa, metadados, gêneros, imagens e os episódios que aparecem no calendário.
- O catálogo, pesquisa, gêneros e calendário vêm do TMDb e não são filtrados pela disponibilidade do Pipoca Cine. Assim, os títulos do TMDb continuam aparecendo mesmo quando um player está indisponível.
- As respostas atuais das listas são arrays JSON de IDs numéricos. O parser também aceita listas TXT separadas por linhas, sem tratar automaticamente um erro JSON como conteúdo válido.
- Antes de carregar um filme, o backend valida a lista de filmes e consulta `/api/embed/{id_tmdb}`. Valida o ID, tipo e URL HTTPS retornados; a resposta atual observada contém `tmdb_id`, `type`, `title` e `embed_url`, sem o campo `ok`.
- A consulta `/api/embed/{id_tmdb}` retornou HTTP 400 para vários IDs que constam na lista de séries (inclusive 36 e 312573). Por isso, o fluxo de séries usa a lista de séries como disponibilidade confirmada e a rota documentada do episódio; não bloqueia a reprodução com uma consulta de metadados que o serviço rejeita.
- Filmes usam `https://pipocacine.online/embed/{id_tmdb}`. Episódios de séries usam `https://pipocacine.online/embed/{id_tmdb}/{temporada}/{episodio}`. Os controles atuais de temporada/episódio e o layout do player são preservados.
- A lista de gêneros e a paginação de descoberta vêm do TMDb, e os resultados não são filtrados pelas listas de IDs do Pipoca Cine.
- O calendário permanece integrado ao catálogo e usa `tv/on_the_air` do TMDb para exibir episódios no ar e próximos lançamentos. A escolha manual de temporada e episódio continua disponível se o calendário não listar episódios para uma série.
- A programação pública mantém as 32 salas existentes e acrescenta 10 salas persistidas, com opções leves durante o dia e terror/suspense à noite. Os filmes vêm do catálogo disponível e avançam diariamente por gênero.
- A reprodução na sala só recebe a URL do embed depois da autorização de participante e da validação, pelo relógio do servidor, do horário de início e da duração da sessão. A rota geral do player também bloqueia títulos reservados por uma sala ativa. A duração vem do TMDb; quando ausente, usa-se estimativa de 170 minutos, identificada na interface. A sala fecha 10 minutos após a duração.
- O criador pode apagar a própria sala privada somente antes do início e quando não há participantes ativos; o servidor valida essas condições sob bloqueio transacional.
- Animes e doramas foram removidos da navegação e das consultas. Filmes e séries permanecem como as categorias principais.

As imagens permanecem servidas pelo CDN do TMDb. A política CSP libera o Pipoca Cine somente como origem do iframe, não como fonte presumida de imagens. Os iframes do provedor não usam `sandbox`, que restringiria recursos do player, e concedem explicitamente tela cheia ao conteúdo incorporado. O cabeçalho `Permissions-Policy` também autoriza tela cheia para essa origem; a interface oferece um botão próprio.

O acesso ao Discord aparece acima da saudação no catálogo, e uma marca d'água discreta identifica o projeto no canto inferior esquerdo.

## Autenticação

O usuário autenticado é obtido da sessão persistida no servidor; atualizar a página não cria uma identidade. Login e cadastro regeneram o ID da sessão, logout destrói a sessão, as operações privadas verificam autenticação/autorização no backend e as operações que alteram estado exigem CSRF. Os cookies são `HttpOnly`, `SameSite=Strict` e `Secure` em produção. A tela do aplicativo também é ocultada imediatamente após logout.

## Deploy no Render

O `render.yaml` configura o serviço como Web Service Node, health check, migrações e Socket.IO. Cadastre os segredos no painel do Render; não há chave de autenticação exigida pelas rotas documentadas do Pipoca Cine.

## Variáveis de ambiente

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Sim | Connection string privada do PostgreSQL |
| `SESSION_SECRET` | Sim | Segredo de sessão aleatório, mínimo de 32 caracteres |
| `TMDB_ACCESS_TOKEN`, `TMDB_TOKEN` ou `TMDB_API_KEY` | Sim para catálogo | Credencial privada do TMDb, usada somente pelo backend |
| `PORT` | Não | Porta do serviço; padrão `3000` |
| `NODE_ENV` | Não | Use `production` no Render |
| `APP_TIMEZONE` | Não | Fuso da programação; padrão `UTC` |
| `ADMIN_USERNAME` e `ADMIN_PASSWORD` | Não | Provisionamento inicial; configure ambos |
| `PG_POOL_MAX` | Não | Limite do pool; padrão `10` |

## Funcionalidades e limites

- Cadastro e login com bcrypt, sessão PostgreSQL, CSRF, limitação de tentativas e painel administrativo.
- Catálogo TMDb de filmes e séries com filtros por gênero, pesquisa, detalhes, calendário e player incorporado.
- Salas públicas e privadas com chat em tempo real, controle de horário e encerramento no servidor. O endpoint de embed do Pipoca Cine não documenta controles de busca, pausa, posição ou revogação de um iframe já carregado. Por isso, o botão “Sincronizar” não é exibido: sem suporte de busca no player, o Cinemix não consegue mudar o instante da reprodução nem interromper um iframe que já foi carregado. “Continuar assistindo” e salvamento fiel do progresso individual dependem de uma API de controle/progresso do player ou de uma fonte de vídeo controlável.
- A qualidade, o áudio, as legendas, a reprodução efetiva e a permissão de incorporação dependem do provedor e do título.
- Os limiters usam memória do processo; em deploy com várias instâncias, substitua-os por armazenamento compartilhado ou limitação equivalente no gateway.

## Verificação

Execute `npm run build` e `npm test`. Os testes unitários cobrem parsing das listas JSON/TXT, validação da resposta real da API de conteúdo e os formatos de URL de filmes e episódios. A verificação de deploy requer o PostgreSQL e as variáveis de ambiente configuradas no serviço Render.
