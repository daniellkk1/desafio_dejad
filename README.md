# A Cidade dos Iguais · DEJAD CEARÁ-MIRIM

Jogo de plataforma em 7 fases com modo single-player e multiplayer (corrida entre jogadores de uma sala, com painel ao vivo para a organização).

## Arquivos

- `index.html` — o jogo (single-player ou multiplayer via `?sala=CODIGO`)
- `painel.html` — painel da organização (criar sala, iniciar, acompanhar ranking)
- `server.js` — backend Node/Express que serve os HTML e responde a API
- `Dockerfile` — imagem para deploy no EasyPanel

O single-player funciona sem servidor (basta abrir `index.html`). O multiplayer precisa do `server.js` no ar.

## Como funciona o multiplayer

- Jogo e painel chamam a API em `API_SERVER`, que está como `''` (relativa). Ou seja, a API é consumida no mesmo domínio que serviu os HTML — por isso rodamos tudo num único serviço, sem CORS.
- Estado das salas fica **em memória**. Reiniciar o container zera as salas (adequado para eventos pontuais; não é persistente).

## Rodar localmente

```bash
npm install
npm start
# abre http://localhost:3000  (jogo)
#       http://localhost:3000/painel.html  (painel)
```

Acesso do painel: use a chave da organização em `OWNER_KEY` (padrão `dejad-admin`).
No painel, cole a chave no campo "Link reservado ou chave" ou acesse com `painel.html#chave=SUACHAVE`.

## Deploy no EasyPanel

1. Crie um **App** apontando para este repositório (Git) ou envie os arquivos.
2. Build method: **Dockerfile** (já incluído).
3. Porta exposta: **3000** (o EasyPanel mapeia para o domínio automaticamente).
4. Variáveis de ambiente (aba Environment):

   | Variável      | Padrão        | Descrição                                   |
   |---------------|---------------|---------------------------------------------|
   | `OWNER_KEY`   | `dejad-admin` | Chave de acesso do painel. **Troque isto.** |
   | `PORT`        | `3000`        | Porta do servidor (deixe 3000)              |
   | `ROUND_MS`    | `1200000`     | Duração da rodada em ms (20 min)            |
   | `COUNTDOWN_MS`| `5000`        | Contagem comum antes do início (5 s)        |

5. Deploy. Acesse `https://seu-dominio/` para o jogo e `https://seu-dominio/painel.html` para o painel.

## Fluxo de uso

1. Organização abre o painel, informa a chave e clica em **CRIAR NOVA SALA**.
2. Compartilha o **link dos jogadores** (contém `?sala=CODIGO`).
3. Jogadores entram com nome e aguardam.
4. Organização clica em **INICIAR PARA TODOS** — todos recebem contagem de 5 s e começam juntos.
5. O painel mostra ranking e pódio ao vivo. O primeiro a concluir as 7 fases vence; empate no mesmo ms desempata pela ordem de entrada.

## Contrato da API (referência)

Jogador:
- `POST /api/join` `{code,name}`
- `GET /api/players/:id` (Bearer token do jogador)
- `POST /api/players/:id/stage` `{phase,answers,collected}`

Organização (Bearer `OWNER_KEY`):
- `GET /api/host/rooms`
- `POST /api/host/rooms` `{title}`
- `POST /api/host/rooms/:code/start`
- `POST /api/host/rooms/:code/end`

Público (painel):
- `GET /api/rooms/:code`

Todas as respostas incluem `serverTime` para sincronização de relógio.
