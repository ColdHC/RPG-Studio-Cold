# Problemas conhecidos

| Item | Severidade | Impacto | Prioridade | Estado | Próximo passo |
|---|---|---|---|---|---|
| Upstream sem licença/contributing/code of conduct versionados | média | impede afirmar termos de redistribuição | alta | aberto | confirmação humana dos mantenedores |
| Rate limit em memória | média | proteção inconsistente em múltiplas réplicas | alta | conhecido | armazenamento compartilhado |
| Data URLs legadas em anexos/temas | média | payload e custo crescem em conteúdo antigo | média | conhecido | migração explícita para `MediaAsset`, sem alterar produção automaticamente |
| Mapas avançados | média | sem rotas, regiões, geometrias ou clustering | média | parcial | criar modelos/rotas validados após uso comprovado |
| Ausência de benchmarks versionados | baixa | ganhos de performance não têm baseline histórico | média | aberto | executar procedimento de `PERFORMANCE.md` |
| Configuração Vercel/Neon externa ao repositório | média | deploy não é reproduzível apenas pelo Git | média | conhecido | documentar configuração sem secrets |
| Conteúdo da campanha na branch principal | alta | risco de exposição em branches/PRs | alta | protegido por branches preparadas | revisar diff e histórico antes de publicar |
| Testes de browser não automatizados no checkout | média | cobertura visual e de interação limitada | média | aberto | adicionar harness separado e seguro |
