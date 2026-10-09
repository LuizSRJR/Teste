# Chá do Bryan

Convite online do chá de bebê do Bryan (domingo, 29/11/2026, às 14h), com Pix opcional e lista de convidados numa planilha do Google da família.

## Como está organizado

| Caminho | O que é |
| --- | --- |
| `public/index.html` | O convite (página principal), com o Pix opcional e o formulário "Confirme sua presença" |
| `api/confirmar.js` | Recebe o formulário e manda o cadastro para a planilha |
| `api/_planilha.js` | Envio para a planilha (endereço do App da Web e fila de reserva) |
| `api/_lib.js` | Funções compartilhadas e a fila privada |
| `planilha/Codigo.gs` | Código que vai dentro da planilha do Google (Extensões > Apps Script) |

## Onde ficam os dados

Cada cadastro vira uma linha na planilha do Google da família, com as caixinhas **Presença autorizada** e
**Presença não autorizada**. A aba **Lista da entrada** mostra só os autorizados, em ordem alfabética.

Se a planilha não responder na hora, o cadastro espera numa fila privada (um arquivo JSON num **Vercel Blob privado**,
variável `BLOB_READ_WRITE_TOKEN`) e é entregue depois, sozinho. Nada da lista aparece no site.
