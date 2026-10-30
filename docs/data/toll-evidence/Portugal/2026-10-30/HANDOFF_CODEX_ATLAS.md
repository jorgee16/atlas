# Atlas — Tabelas de portagens Portugal 2026 (handoff para Codex)

**Consulta das fontes:** 2026-10-30. **Moeda:** EUR. **Âmbito:** Portugal; 2026. **Estado:** dataset nacional inicial, **não exaustivo**; não assumir cobertura de qualquer par de localidades.

## Ficheiros

- `tarifas_portagens_2026.csv`: um registo de preço por **classe de veículo**; 26 colunas; UTF-8 BOM para Excel; preços decimais `7.65`, usar `Decimal`/cêntimos, não `float`.
- `tarifas_portagens_2026.json`: versão estruturada com os mesmos registos e políticas de isenção.
- `excecoes_zero_2026.csv`: áreas legalmente isentas. **Não é matriz origem/destino**.
- `portagens_2026.xlsx`: workbook para auditoria humana, com preços e restrições (se incluído).
- `build_data.py`: fonte textual de extração/normalização **manual** a partir de documentos publicados. **Não é um scraper em tempo real**. Conferir contra as fontes em futuras atualizações.
- `resumo.json`: cobertura e contagens.

## Esquema e interpretação

`tipo_registo` assume `percurso_OD_explicito`, `sublanco`/`sublanço`, `portico`, `praça/sublanço`, `ponte`.

`origem_exata` e `destino_exato` preservam os **nós/sublanços que constam da fonte**, e não representam coordenadas GPS, moradas, acessos OSRM/OSM ou localidades genéricas.

`itinerario_vias` identifica a(s) via(s) explicitamente documentada(s), não a geometria da rota. `sentido = nao_especificado_pela_fonte` **NÃO** autoriza tratar a tarifa como bidirecional. Só entradas da matriz OD têm sentido O→D definido, e as pontes têm sentido para Lisboa baseado em fonte secundária, com validação oficial pendente.

`vigencia_inicio` está preenchida apenas quando o documento informa a data (Brisa matriz 2026). Nos outros casos a fonte informa apenas o **ano**. `data_consulta` é data da pesquisa, não início de vigência.

`entrada`, `saida`, `praca`, `portico`, `sublanco` retêm nomenclatura da fonte conforme a informação publicada; não interpretar um pórtico entre dois nós como se fosse um preço de uma rota do nó A ao nó B em ambos os sentidos. Em registos IMT o par origin/dest é um **lanço oficial**, mas **não** equivale a um itinerário independente confirmado no simulador para par de cidades.

`estado_validacao`: `CONFLITO_...` é bloqueador. `localizacao_geometrica_por_validar` significa que preço e identificação textual estão publicados, mas não foi feita a associação a segmentos direcionais e nós OSM reais. Não usar só correspondência de `road_name`.

## Requisitos de implementação para Codex

1. Criar provider `PT/2026` independente de core de cálculo, com versionamento de esquema, país, ano, moeda, fontes e checksums. Adicionar adaptadores futuros de outros países sem alterar o motor.
2. Indexar separadamente tarifas **fechadas O/D**, cobranças em **pórticos**, regras de **sublanços**, **praças fixas**, **pontes unidirecionais**, **isenções legais**. Identificadores das concessionárias não devem ser convertidos em coordenadas sem verificação.
3. Se o percurso calculado contém uma combinação **idêntica** de entrada + saída + sentido + via + classe + data do registo `percurso_OD_explicito`, aceitar só esse preço. **Não reutilizar para outro trajeto** da mesma autoestrada e não somar pórticos de dentro do mesmo percurso contabilizados por essa cotação.
4. Para trajetos sem O/D confirmado, só computar se os **pontos de cobrança/lanços concretos** forem cruzados pela geometria da rota com sentido e cobertura validados (map-matching sobre OSM, identificadores próprios `toll_point_id` / `toll_segment_id`). Unicidade de evento de portagem; ligar a chave geográfica sem perder o texto da fonte. Um total de lanços IMT não é automaticamente uma fatura final; verificar lógica de portagem fechada, arredondamentos e descontos.
5. Se uma rota atravessa zona isenta aplicável na data, aplicar regra *ao troço efetivamente isento*, sem inferir isenção de vias com o mesmo número noutras concessionárias (particularmente A13, A28 e A4). A A25 integral está isenta a partir de 2026-01-01, incluindo Aveiro–Albergaria. É errada qualquer regra global `A13=0`, `A4=0`, `A28=0`.
6. A41: preços classe 3/4 da tabela **IMT** são positivos e os da **Ascendi** são publicados como `0,00` em vários sublanços. Marcar conflito e não calcular automaticamente sem investigação da regra por regime/classe e data. São **36 linhas** sinalizadas.
7. Ponte 25 de Abril e Ponte Vasco da Gama: preços oficiais do IMT, mas só aplicar se o percurso *cruza* a ponte no sentido de pagamento. Confirmar a posição geométrica e direção em documento da Lusoponte antes de marcar `validated`.
8. `Classe 5` publicada na Ascendi é exclusiva para motociclos com dispositivo eletrónico; não extrapolar para viaturas classe 1 nem para Brisa/Lusoponte. Classes 1-4 devem ser determinadas segundo regras oficiais da via.
9. Resultado deve distinguir: `confirmed_route_price`, `confirmed_charges_with_verified_crossings`, `partial_estimate`, `unavailable`, `no_tolls_confirmed`. **Nunca apresentar `0 EUR` por falta de dados**. Separar estimativas de valores confirmados.
10. Interações com GPS offline: manter cache da tabela por país; assinatura/checksum de atualização; em caso de falha de download, usar a versão validada guardada. Não bloquear UI da navegação. Reroute deve recalcular pelo conjunto *novo* de portagens cruzadas.
11. Testes: par exato Coimbra Norte (0117) → Fátima (0122) pela A1, classe 1 = **7,65 €** (Brisa matriz); classe 2 = **13,35 €**, classe 3 = **17,25 €**, classe 4 = **19,05 €**. Outra entrada, outro destino ou outra estrada **não** podem devolver esse mesmo preço por correspondência aproximada. A5 Oeiras–Carcavelos classe 1 é um **lanço** de 0,70 € IMT, não um bilhete qualquer para Lisboa–Cascais. A41 classe 3/4 deve devolver `unavailable/conflict` até resolução. Algarve A22 sem portagens legais (dentro do âmbito do diploma).
12. Respeitar cobertura e limitações antes de expor uma estimativa ao utilizador. Apresentar lista de portagens associadas, fontes e data na ficha da rota; distinguir `Tolls: — (dados insuficientes)` de `Tolls: 0,00€ (verificado)`.

## Pendências de cobertura nacional

- **Cobertura incompleta de matrizes entrada–saída**: somente 6 pares A1 foram extraídos especificamente da matriz Brisa, em 4 classes. O PDF da Brisa publica muitas combinações adicionais, que precisam de uma extração tabular rigorosa baseada nas posições reais das células; a extração de texto simples perde as células vazias e pode desalinhá-las. Não gerar pares O/D artificialmente.
- **Concessões/vias ainda sem preços individuais confirmados neste pacote**: partes pagas da **A28**, **A33 / Baixo Tejo**, **A19 / Litoral Oeste**, e demais sublanços de concessões não abrangidas pelas fontes consultadas; verificar junto da IP e operadoras.
- **Georreferenciação e sentido**: nenhum pórtico foi associado com segurança a OSM Way ID / coordenadas ou sentido de tráfego (salvo convenção textual das pontes); estes campos continuam por validar em mapas de concessionárias ou com dados geo oficiais.
- **Tarifários especiais**: descontos para algumas classes ou pagamento eletrónico, regimes temporais, IVA fora da taxa geral, alteração das tarifas no decorrer do ano, exceções de modelos específicos de veículos não estão representados.
- **Revisão humana**: conferir linhas A41 classes 3 e 4 em ambas as fontes; resolver diferença antes da produção.

## Fontes oficiais consultadas

- IMT, tarifas 2026 por lanço, Classes 1-4: https://www.imt-ip.pt/rodoviario/infraestruturas-rodoviarias/rede-rodoviaria/taxas-de-portagem/
- Brisa Concessão, matriz entrada–saída por classe, taxas em vigor desde 2026-01-01, IVA incluído: https://www.brisaconcessao.pt/Portals/0/TabelaEcadaTaxas_23iva_01012026.pdf?ver=2025-12-30-183235-260
- Ascendi, portagens tradicionais 2026 (A7, A11, A16, A32, A41, A43): https://ascendi.pt/portagens-tradicionais/
- Ascendi, portagens eletrónicas 2026 (A17, A29, A4, A41, A42): https://ascendi.pt/portagens-eletronicas/
- Lei n.º 37/2024 consolidada, alterada pelo Orçamento do Estado 2026: https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2024-875716621
- IP, confirmação A25 integral isenta desde 2026-01-01 e outras isenções: https://servicos.infraestruturasdeportugal.pt/portagens-ips
- Via Verde, calculador online (consulta interativa, **não recolhidos preços dinâmicos**): https://www.viaverde.pt/ferramentas/calculador-de-portagens

**Nota de qualidade:** este dataset deriva de transcrição controlada de publicações oficiais consultadas, com verificação automática de unicidade, presença de dois pontos textuais, preço e classe, mas **sem validação ponta a ponta em simulador** para todos os preços. Não alegar essa validação. Dados completos de um país exigem um projeto de ingestão, auditoria de fontes e correspondência geoespacial adicional.
