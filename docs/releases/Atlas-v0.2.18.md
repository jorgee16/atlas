# Atlas v0.2.18 — Portagens com cobertura parcial

Release de teste Android com assinatura persistente, package ID `com.atlas.nativeapp` e versionCode 21.

## Novidades

- Expansão das correspondências de portagens entre entradas, saídas e pórticos e o grafo de Portugal.
- A1: 13 estações entre Grijó PV e Torres Novas. Dos 156 pares dirigidos ensaiados na classe 1, 117 têm preço confirmado e 39 permanecem incompletos. Os percursos extremos de cerca de 192 km são confirmados nas quatro classes.
- A9/A16: tarifas oficiais por lanço e correspondências revistas, com a cobrança de Idanha separada.
- A29: percursos de cerca de 39,5 km nos dois sentidos, atravessando os quatro pórticos.
- Alternativas com tempo e preço em destaque; nomes legíveis das estações nos detalhes.
- Preços desconhecidos não são apresentados como zero confirmado. Estimativas continuam identificadas.

## Cobertura e validação

Esta versão não tem cobertura nacional exata de portagens. Alguns acessos da A1, a continuação sul e a fronteira partilhada A9/A1 em Alverca continuam por certificar. As linhas tarifárias conflitantes da A41 permanecem inativas.

A publicação exige testes C++/Kotlin/Android, 562 cenários de preços via JNI, smoke de GPS/câmara, replay GPS completo em emulador, certificado persistente e atualização sem desinstalação. Não representa ensaios de condução real, túneis reais ou comparação completa com simuladores Via Verde.

Instalar diretamente o ficheiro `Atlas-v0.2.18.apk`. Instalações Release anteriores devem atualizar preservando dados; instalações Debug com outro certificado podem exigir uma primeira instalação limpa.

Relatório técnico e limitações: `docs/validation/issue-2-toll-evidence.md`.
