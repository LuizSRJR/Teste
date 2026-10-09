# Chá do Bryan

Convite online do chá de bebê do Bryan (domingo, 29/11/2026, às 14h) com lista de convidados aprovada pela família.

## Como está organizado

| Caminho | O que é |
| --- | --- |
| `public/index.html` | O convite (página principal) |
| `public/lista.html` | Área da família em `/lista`: aprovar, recusar, adicionar e imprimir a lista (pede senha) |
| `api/confirmar.js` | Recebe o formulário "Confirme sua presença" (o pedido fica aguardando aprovação) |
| `api/admin.js` | Ações da área da família (só funciona com a senha) |
| `api/_lib.js` | Funções compartilhadas e acesso ao armazenamento |

## Onde ficam os dados

Os pedidos ficam num único arquivo JSON dentro de um **Vercel Blob privado** ligado a este projeto (variável `BLOB_READ_WRITE_TOKEN`, criada pela própria Vercel). Cada gravação confere a versão do arquivo, então dois convidados enviando ao mesmo tempo não apagam o pedido um do outro.
Nada da lista aparece no site nem neste repositório. A senha da família também não fica aqui: o código guarda só um "hash" dela.

Depois do chá, use o botão **Apagar tudo** na área da família para apagar os documentos dos convidados.
