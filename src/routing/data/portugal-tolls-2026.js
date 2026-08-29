// Portugal toll dataset for routing decisions and price calculation.
//
// Important: this file models real charged sub-sections / toll points. It must
// never infer that an entire motorway is tolled simply because its ref is Axx.
// A route is chargeable only when it crosses a matching charged section/point.
//
// Primary 2026 sources:
// - IMT validated national toll tables (2026)
// - Infraestruturas de Portugal 2026 toll update / zero-rated sections
// - Ascendi traditional/electronic toll tables
// - Lusoponte official bridge tariffs
// - Lei n.º 37/2024 as amended by Lei n.º 73-A/2025
//
// Geographic matching to graph edges is intentionally a separate step. The
// names below are the authoritative tariff boundaries/gantry names to map to
// OSM ways/nodes during packaging, rather than relying on a road ref alone.

export const PORTUGAL_TOLL_DATASET_VERSION = '2026-08-29';

export const PORTUGAL_TOLL_SOURCES = Object.freeze({
  imt2026: 'https://www.imt-ip.pt/rodoviario/infraestruturas-rodoviarias/rede-rodoviaria/taxas-de-portagem/',
  ip2026: 'https://servicos.infraestruturasdeportugal.pt/portagens-ips',
  ascendiTraditional: 'https://www.ascendi.pt/portagens-tradicionais/',
  ascendiElectronic: 'https://www.ascendi.pt/portagens-eletronicas/',
  lusoponte25Abril: 'https://www.lusoponte.pt/25-de-abril/informacoes-gerais',
  lusoponteVascoGama: 'https://www.lusoponte.pt/vasco-da-gama/informacoes-gerais',
  lawZeroTolls: 'https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2024-875716621'
});

const tariffs = (c1, c2, c3, c4, c5 = null) => Object.freeze({
  1: c1,
  2: c2,
  3: c3,
  4: c4,
  ...(Number.isFinite(c5) ? { 5: c5 } : {})
});

const section = (
  roadRef,
  id,
  from,
  to,
  km,
  values,
  {
    operator,
    system = 'closed-or-traditional',
    source = 'imt2026',
    direction = null
  } = {}
) => Object.freeze({
  id: `${roadRef}:${id}`,
  roadRef,
  from,
  to,
  km,
  tariffs: values,
  operator,
  system,
  source,
  ...(direction ? { direction } : {})
});

const gantry = (
  roadRef,
  id,
  name,
  values,
  {
    operator = 'Ascendi',
    source = 'ascendiElectronic',
    direction = null
  } = {}
) => Object.freeze({
  id: `${roadRef}:gantry:${id}`,
  roadRef,
  name,
  tariffs: values,
  operator,
  system: 'electronic-gantry',
  source,
  ...(direction ? { direction } : {})
});

export const PORTUGAL_TOLL_SECTIONS_2026 = Object.freeze([
  // Brisa / IMT validated sections.
  section('A1','01','Alverca (A1/A9)','Vila Franca de Xira II',7.0,tariffs(.50,.85,1.10,1.25),{operator:'Brisa'}),
  section('A1','02','Vila Franca de Xira II','Vila Franca de Xira I',3.9,tariffs(.25,.50,.60,.70),{operator:'Brisa'}),
  section('A1','03','Vila Franca de Xira I','Castanheira do Ribatejo',3.9,tariffs(.50,.85,1.10,1.25),{operator:'Brisa'}),
  section('A1','04','Castanheira do Ribatejo','A1/A10',1.2,tariffs(.15,.25,.35,.40),{operator:'Brisa'}),
  section('A1','05','Ligação PLLN','Ligação PLLN',1.3,tariffs(.15,.25,.30,.35),{operator:'Brisa'}),
  section('A1','06','A1/A10','Carregado',.9,tariffs(.10,.20,.25,.30),{operator:'Brisa'}),
  section('A1','07','Carregado','Aveiras de Cima',15.6,tariffs(1.10,1.95,2.50,2.80),{operator:'Brisa'}),
  section('A1','08','Aveiras de Cima','Cartaxo',11.3,tariffs(1.00,1.75,2.25,2.50),{operator:'Brisa'}),
  section('A1','09','Cartaxo','Santarém',8.0,tariffs(.70,1.25,1.60,1.80),{operator:'Brisa'}),
  section('A1','10','Santarém','A1/A15',1.3,tariffs(.15,.20,.30,.30),{operator:'Brisa'}),
  section('A1','11','A1/A15','Torres Novas (A1/A23)',26.9,tariffs(2.65,4.65,5.95,6.60),{operator:'Brisa'}),
  section('A1','12','Torres Novas (A1/A23)','Fátima',20.5,tariffs(2.05,3.55,4.60,5.10),{operator:'Brisa'}),
  section('A1','13','Fátima','Leiria',15.2,tariffs(1.45,2.50,3.25,3.60),{operator:'Brisa'}),
  section('A1','14','Leiria','Pombal',24.0,tariffs(2.45,4.25,5.45,6.05),{operator:'Brisa'}),
  section('A1','15a','Pombal','Soure',14.9,tariffs(1.45,2.55,3.30,3.65),{operator:'Brisa'}),
  section('A1','15b','Soure','Condeixa',12.8,tariffs(1.25,2.20,2.85,3.15),{operator:'Brisa'}),
  section('A1','16','Condeixa','Coimbra Sul',7.7,tariffs(.50,.85,1.10,1.20),{operator:'Brisa'}),
  section('A1','17','Coimbra Sul','Coimbra Norte (A1/A14)',8.3,tariffs(.55,1.00,1.30,1.40),{operator:'Brisa'}),
  section('A1','18','Coimbra Norte (A1/A14)','Mealhada',11.7,tariffs(.85,1.45,1.90,2.10),{operator:'Brisa'}),
  section('A1','19','Mealhada','Aveiro Sul',23.6,tariffs(2.10,3.70,4.75,5.25),{operator:'Brisa'}),
  section('A1','20','Aveiro Sul','Albergaria (A1/IP5)',14.7,tariffs(1.25,2.20,2.85,3.15),{operator:'Brisa'}),
  section('A1','21','Albergaria (A1/IP5)','Estarreja',10.4,tariffs(.95,1.70,2.15,2.40),{operator:'Brisa'}),
  section('A1','22','Estarreja','Feira',16.8,tariffs(1.45,2.50,3.25,3.60),{operator:'Brisa'}),
  section('A1','23','Feira','Espinho (IC24)',9.8,tariffs(.95,1.70,2.15,2.40),{operator:'Brisa'}),
  section('A1','24','Espinho (IC24)','Carvalhos',7.3,tariffs(.70,1.25,1.60,1.80),{operator:'Brisa'}),

  section('A2','01','Fogueteiro','Coina',8.9,tariffs(.90,1.55,2.00,2.20),{operator:'Brisa'}),
  section('A2','02','Coina','Palmela',11.5,tariffs(.85,1.50,1.90,2.10),{operator:'Brisa'}),
  section('A2','03','Palmela','A2/A12',2.0,tariffs(.10,.15,.20,.25),{operator:'Brisa'}),
  section('A2','04','A2/A12','Marateca',17.3,tariffs(1.85,3.25,4.15,4.60),{operator:'Brisa'}),
  section('A2','05','Marateca','A2/A6/A13',2.3,tariffs(.25,.45,.55,.65),{operator:'Brisa'}),
  section('A2','06','A2/A6/A13','Alcácer do Sal',24.8,tariffs(2.70,4.75,6.10,6.80),{operator:'Brisa'}),
  section('A2','07','Alcácer do Sal','Grândola Norte',22.6,tariffs(2.40,4.20,5.40,6.00),{operator:'Brisa'}),
  section('A2','08','Grândola Norte','Grândola Sul',15.4,tariffs(1.65,2.85,3.70,4.10),{operator:'Brisa'}),
  section('A2','09','Grândola Sul','Aljustrel',31.5,tariffs(3.45,6.05,7.80,8.65),{operator:'Brisa'}),
  section('A2','10','Aljustrel','Castro Verde',26.8,tariffs(2.95,5.15,6.60,7.35),{operator:'Brisa'}),
  section('A2','11','Castro Verde','Almodôvar',16.8,tariffs(1.80,3.20,4.10,4.55),{operator:'Brisa'}),
  section('A2','12','Almodôvar','S. B. Messines',33.1,tariffs(3.60,6.25,8.05,8.95),{operator:'Brisa'}),
  section('A2','13','S. B. Messines','Paderne (A22)',12.2,tariffs(1.30,2.30,2.95,3.30),{operator:'Brisa'}),

  section('A3','01','Maia','Santo Tirso',12.8,tariffs(1.15,2.05,2.60,2.90),{operator:'Brisa'}),
  section('A3','02','Santo Tirso','Famalicão',5.4,tariffs(.50,.85,1.10,1.25),{operator:'Brisa'}),
  section('A3','03','Famalicão','Cruz',8.6,tariffs(.75,1.35,1.70,1.90),{operator:'Brisa'}),
  section('A3','04','Cruz','Braga Sul',7.3,tariffs(.80,1.35,1.75,1.95),{operator:'Brisa'}),
  section('A3','05','Braga Sul','Braga Oeste',4.5,tariffs(.50,.85,1.10,1.20),{operator:'Brisa'}),
  section('A3','06','Braga Oeste','EN 201',19.9,tariffs(2.20,3.80,4.90,5.45),{operator:'Brisa'}),
  section('A3','07','EN 201','Ponte de Lima Sul',10.0,tariffs(1.10,1.90,2.45,2.75),{operator:'Brisa'}),
  section('A3','08','Ponte de Lima Sul','Ponte de Lima Norte',.8,tariffs(.10,.15,.20,.20),{operator:'Brisa'}),
  section('A3','09','Ponte de Lima Norte','EN 303',20.8,tariffs(2.25,3.95,5.05,5.60),{operator:'Brisa'}),
  section('A3','10','EN 303','Valença',8.0,tariffs(.85,1.50,1.95,2.15),{operator:'Brisa'}),
  section('A3','11','Braga Sul','Celeirós',2.2,tariffs(.25,.40,.55,.60),{operator:'Brisa'}),

  section('A4','01','Ermesinde','Valongo',4.3,tariffs(.40,.70,.90,1.00),{operator:'Brisa'}),
  section('A4','02','Valongo','Campo',5.0,tariffs(.40,.65,.85,.95),{operator:'Brisa'}),
  section('A4','03','Campo','Baltar',6.4,tariffs(.65,1.15,1.50,1.70),{operator:'Brisa'}),
  section('A4','04','Baltar','Paredes',5.8,tariffs(.50,.85,1.10,1.20),{operator:'Brisa'}),
  section('A4','05','Paredes','Guilhufe',2.6,tariffs(.30,.50,.65,.70),{operator:'Brisa'}),
  section('A4','06','Guilhufe','Penafiel',2.2,tariffs(.20,.35,.45,.50),{operator:'Brisa'}),
  section('A4','07','Penafiel','Castelões (A4/IP9)',7.7,tariffs(.75,1.30,1.70,1.90),{operator:'Brisa'}),
  section('A4','08','Castelões (A4/IP9)','Geraldes',14.3,tariffs(1.55,2.75,3.55,3.90),{operator:'Brisa'}),

  section('A5','01','Estádio Nacional','Oeiras',3.5,tariffs(.40,.75,.75,.75),{operator:'Brisa'}),
  section('A5','02','Oeiras','Carcavelos',6.9,tariffs(.70,1.35,1.35,1.35),{operator:'Brisa'}),
  section('A5','03','Carcavelos','Estoril',8.7,tariffs(.90,1.75,1.75,1.75),{operator:'Brisa'}),
  section('A5','04','Estoril','Cascais',4.7,tariffs(.50,.95,.95,.95),{operator:'Brisa'}),

  section('A6','01','A2/A6/A13','Vendas Novas',19.5,tariffs(2.15,3.75,4.80,5.35),{operator:'Brisa'}),
  section('A6','02','Vendas Novas','Montemor-o-Novo Poente',18.7,tariffs(2.05,3.60,4.60,5.15),{operator:'Brisa'}),
  section('A6','03','Montemor-o-Novo Poente','Montemor-o-Novo Nascente',5.5,tariffs(.65,1.15,1.45,1.60),{operator:'Brisa'}),
  section('A6','04','Montemor-o-Novo Nascente','Évora Poente',15.2,tariffs(1.65,2.90,3.70,4.10),{operator:'Brisa'}),
  section('A6','05','Évora Poente','Évora Nascente',16.0,tariffs(1.75,3.05,3.90,4.35),{operator:'Brisa'}),
  section('A6','06','Évora Nascente','Estremoz',29.8,tariffs(3.20,5.65,7.25,8.05),{operator:'Brisa'}),
  section('A6','07','Estremoz','Borba',12.0,tariffs(1.30,2.25,2.90,3.25),{operator:'Brisa'}),
  section('A6','08','Borba','Elvas Poente',22.1,tariffs(2.40,4.20,5.40,5.95),{operator:'Brisa'}),

  section('A8','01','Loures','CREL',1.5,tariffs(0,0,0,0),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','02','CREL','Lousa',7.8,tariffs(.75,1.35,1.70,1.90),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','03','Lousa','Malveira',2.4,tariffs(.20,.35,.45,.50),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','04','Malveira','Enxara',7.9,tariffs(.85,1.50,1.95,2.15),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','05','Enxara','Torres Vedras Sul',9.5,tariffs(1.05,1.80,2.35,2.60),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','06','Torres Vedras Sul','Torres Vedras Norte',5.9,tariffs(.65,1.10,1.40,1.60),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','07','Torres Vedras Norte','Ramalhal',2.2,tariffs(.25,.40,.55,.60),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','08','Ramalhal','Campelos',9.5,tariffs(1.05,1.80,2.30,2.60),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','09','Campelos','Bombarral',8.0,tariffs(.85,1.50,1.95,2.15),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','10','Caldas da Rainha (Z. Industrial)','Tornada',3.5,tariffs(.40,.65,.85,.95),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','11','Tornada','Alfeizerão',7.6,tariffs(.80,1.45,1.85,2.05),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','12','Alfeizerão','Valado dos Frades',12.1,tariffs(1.30,2.30,2.95,3.25),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','13','Valado dos Frades','Pataias',7.0,tariffs(.75,1.35,1.70,1.90),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','14','Pataias','Marinha Grande Sul',9.5,tariffs(1.05,1.80,2.30,2.55),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','15','Marinha Grande Sul','A17',3.1,tariffs(.35,.60,.75,.85),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','16','Marinha Grande Sul','Marinha Grande Este',5.2,tariffs(.55,1.00,1.25,1.40),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','17','A17','Marinha Grande Este',1.3,tariffs(.15,.25,.35,.35),{operator:'Auto-Estradas do Atlântico'}),
  section('A8','18','Marinha Grande Este','Leiria Sul',4.3,tariffs(.45,.80,1.05,1.15),{operator:'Auto-Estradas do Atlântico'}),

  section('A9','01','Estádio Nacional (A5/A9)','Queluz',3.4,tariffs(.35,.65,.85,.95),{operator:'Brisa'}),
  section('A9','02','Queluz','A9/A16',2.9,tariffs(.30,.55,.70,.80),{operator:'Brisa'}),
  section('A9','03','A9/A16','Radial da Pontinha',3.1,tariffs(.35,.60,.75,.85),{operator:'Brisa'}),
  section('A9','04','Radial da Pontinha','Radial Odivelas',6.8,tariffs(.75,1.30,1.70,1.85),{operator:'Brisa'}),
  section('A9','05','Radial Odivelas','A8/A9',3.5,tariffs(.40,.65,.85,.95),{operator:'Brisa'}),
  section('A9','06','A8/A9','Bucelas (Zambujal)',3.4,tariffs(.35,.65,.85,.95),{operator:'Brisa'}),
  section('A9','07','Bucelas (Zambujal)','A9/A10',8.3,tariffs(.90,1.60,2.05,2.30),{operator:'Brisa'}),
  section('A9','08','A9/A10','Alverca',3.0,tariffs(.35,.60,.75,.80),{operator:'Brisa'}),

  section('A10','01','A9/A10','Arruda dos Vinhos',6.9,tariffs(.75,1.30,1.65,1.85),{operator:'Brisa'}),
  section('A10','02','Arruda dos Vinhos','Carregado (A1/A10)',11.0,tariffs(1.20,2.05,2.65,2.95),{operator:'Brisa'}),
  section('A10','03','Carregado','Benavente',14.5,tariffs(1.55,2.70,3.50,3.85),{operator:'Brisa'}),
  section('A10','04','Benavente','A10/A13',7.4,tariffs(.80,1.40,1.80,2.00),{operator:'Brisa'}),

  section('A12','01','Montijo','Pinhal Novo',10.2,tariffs(1.10,1.95,2.50,2.75),{operator:'Brisa'}),
  section('A12','02','Pinhal Novo','A2/A12',9.4,tariffs(1.00,1.80,2.30,2.55),{operator:'Brisa'}),
  section('A12','03','A2/A12','Setúbal',5.2,tariffs(.35,.65,.85,.95),{operator:'Brisa'}),

  section('A13','01','Almeirim','Salvaterra de Magos',25.9,tariffs(2.75,4.85,6.20,6.90),{operator:'Brisa'}),
  section('A13','02','Salvaterra de Magos','A13/A10',12.4,tariffs(1.30,2.30,3.00,3.30),{operator:'Brisa'}),
  section('A13','03','A13/A10','Santo Estêvão',10.9,tariffs(1.15,2.05,2.60,2.90),{operator:'Brisa'}),
  section('A13','04','Santo Estêvão','Pegões',19.3,tariffs(2.10,3.65,4.70,5.20),{operator:'Brisa'}),
  section('A13','05','Pegões','Marateca',10.2,tariffs(1.10,1.95,2.50,2.75),{operator:'Brisa'}),

  section('A14','01','Santa Eulália','Montemor-o-Velho',4.8,tariffs(.50,.90,1.15,1.30),{operator:'Brisa'}),
  section('A14','02','Montemor-o-Velho','EN335',8.0,tariffs(.85,1.50,1.95,2.15),{operator:'Brisa'}),
  section('A14','03','EN335','Ançã',9.6,tariffs(1.05,1.80,2.35,2.60),{operator:'Brisa'}),
  section('A14','04','Ançã','Coimbra Norte (A14/A1)',4.4,tariffs(.50,.85,1.05,1.20),{operator:'Brisa'}),

  section('A15','01','Arnóia','A-dos-Negros',4.0,tariffs(.45,.75,.95,1.10),{operator:'Auto-Estradas do Atlântico'}),
  section('A15','02','A-dos-Negros','A-dos-Francos',8.9,tariffs(.95,1.70,2.15,2.40),{operator:'Auto-Estradas do Atlântico'}),
  section('A15','03','A-dos-Francos','Rio Maior Oeste',5.7,tariffs(.60,1.10,1.40,1.55),{operator:'Auto-Estradas do Atlântico'}),
  section('A15','04','Rio Maior Oeste','Rio Maior Este',3.3,tariffs(.35,.65,.80,.90),{operator:'Auto-Estradas do Atlântico'}),
  section('A15','05','Rio Maior Este','Malaqueijo',7.5,tariffs(.80,1.40,1.80,2.00),{operator:'Auto-Estradas do Atlântico'}),
  section('A15','06','Malaqueijo','A1/A15',10.8,tariffs(1.15,2.05,2.60,2.90),{operator:'Auto-Estradas do Atlântico'}),

  section('A17','01','A8/A17','Leiria Norte (N/S)',10.3,tariffs(1.10,1.95,2.50,2.80),{operator:'Brisal'}),
  section('A17','02','A8/A17','Leiria Norte (N/E)',9.4,tariffs(1.00,1.80,2.30,2.55),{operator:'Brisal'}),
  section('A17','03','Leiria Norte','Monte Real',4.5,tariffs(.50,.85,1.10,1.20),{operator:'Brisal'}),
  section('A17','04','Monte Real','Monte Redondo',5.3,tariffs(.55,1.00,1.30,1.45),{operator:'Brisal'}),
  section('A17','05','Monte Redondo','Guia',6.6,tariffs(.70,1.25,1.60,1.80),{operator:'Brisal'}),
  section('A17','06','Guia','Louriçal (IC8)',5.6,tariffs(.60,1.05,1.35,1.50),{operator:'Brisal'}),
  section('A17','07','Louriçal (IC8)','Marinha das Ondas',6.5,tariffs(.70,1.25,1.60,1.75),{operator:'Brisal'}),
  section('A17','08','Marinha das Ondas','A14',16.3,tariffs(1.75,3.10,3.95,4.40),{operator:'Brisal'}),
  section('A17','09','A14','Quiaios',8.6,tariffs(.95,1.65,2.10,2.35),{operator:'Brisal'}),
  section('A17','10','Quiaios','Tocha',14.3,tariffs(1.55,2.70,3.50,3.85),{operator:'Brisal'}),
  section('A17','11','Tocha','Mira',10.3,tariffs(1.10,1.95,2.50,2.80),{operator:'Brisal'}),
  section('A17','12','Mira','Mira PV',4.4,tariffs(.50,.85,1.05,1.20),{operator:'Brisal'}),

  section('A21','01','Ericeira','Mafra Oeste',5.2,tariffs(.55,1.00,1.25,1.40),{operator:'Infraestruturas de Portugal'}),
  section('A21','02','Mafra Oeste','Mafra Este',6.8,tariffs(.75,1.30,1.65,1.85),{operator:'Infraestruturas de Portugal'}),
  section('A21','03','Mafra Este','Malveira',5.3,tariffs(.55,1.00,1.30,1.45),{operator:'Infraestruturas de Portugal'}),
  section('A21','04','Malveira','Venda do Pinheiro',3.4,tariffs(.35,.65,.85,.90),{operator:'Infraestruturas de Portugal'}),

  section('A32','01','EN224','EN227',2.1,tariffs(.20,.40,.50,.55),{operator:'Douro Litoral'}),
  section('A32','02','EN227','Feira-Mansores',8.6,tariffs(.90,1.60,2.05,2.30),{operator:'Douro Litoral'}),
  section('A32','03','Feira-Mansores','Gião-Louredo',5.4,tariffs(.60,1.00,1.30,1.45),{operator:'Douro Litoral'}),
  section('A32','04','Gião-Louredo','Canedo',3.7,tariffs(.40,.70,.90,1.00),{operator:'Douro Litoral'}),
  section('A32','05','Canedo','A32/A41',3.2,tariffs(.35,.60,.75,.85),{operator:'Douro Litoral'}),
  section('A32','06','A32/A41','Olival',3.8,tariffs(.40,.70,.90,1.00),{operator:'Douro Litoral'}),
  section('A32','07','Olival','A32/A1',5.8,tariffs(.60,1.10,1.40,1.55),{operator:'Douro Litoral'}),

  section('A41','DL01','Argoncilhe','Sandim',6.0,tariffs(.65,1.10,1.45,1.60),{operator:'Douro Litoral'}),
  section('A41','DL02','Sandim','A32/A41',1.3,tariffs(.15,.25,.30,.35),{operator:'Douro Litoral'}),
  section('A41','DL03','A32/A41','Medas',5.0,tariffs(.55,.95,1.20,1.35),{operator:'Douro Litoral'}),
  section('A41','DL04','Medas','A41/A43',3.0,tariffs(.30,.55,.70,.80),{operator:'Douro Litoral'}),
  section('A41','DL05','A41/A43','Aguiar de Sousa',6.2,tariffs(.65,1.15,1.50,1.65),{operator:'Douro Litoral'}),
  section('A41','DL06','Aguiar de Sousa','Z.I.C.',3.4,tariffs(.35,.65,.80,.90),{operator:'Douro Litoral'}),
  section('A41','DL07','Z.I.C.','A4/A41',1.6,tariffs(.15,.30,.40,.45),{operator:'Douro Litoral'}),
  section('A41','DL08','A4/A41','Gandra',3.9,tariffs(.40,.75,.95,1.05),{operator:'Douro Litoral'}),
  section('A41','DL09','Gandra','A41/A42',2.4,tariffs(.25,.45,.55,.65),{operator:'Douro Litoral'}),

  section('A43','01','Gondomar','Gens',4.3,tariffs(.45,.80,1.05,1.15),{operator:'Douro Litoral'}),
  section('A43','02','Gens','A41/A43',3.6,tariffs(.40,.65,.85,.95),{operator:'Douro Litoral'}),

  // Ascendi traditional sections. These are sublanços / toll plazas, not a
  // blanket motorway flag.
  section('A16','01','Idanha','IC16/CREL (A. Colaride)',null,tariffs(.65,1.15,1.50,1.65,.46),{operator:'Ascendi',source:'ascendiTraditional',system:'traditional-plaza'}),
  section('A16','02','Sacotes','Telhal',null,tariffs(.65,1.10,1.45,1.60,.46),{operator:'Ascendi',source:'ascendiTraditional',system:'traditional-plaza'}),
  section('A16','03','Ranholas','Linhó',null,tariffs(1.20,2.10,2.70,2.95,.84),{operator:'Ascendi',source:'ascendiTraditional',system:'traditional-plaza'}),

  section('A7','01','IC1','EN206',null,tariffs(.30,.55,.75,.80,.21),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','02','EN206','Nó de Famalicão',null,tariffs(1.95,3.40,4.35,4.85,1.37),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','03','Nó de Famalicão','Famalicão A3/A7',null,tariffs(.15,.30,.35,.40,.11),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','04','Famalicão A3/A7','Ceide',null,tariffs(.40,.65,.85,.95,.28),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','05','Ceide','Ave',null,tariffs(.75,1.35,1.70,1.90,.53),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','06','Ave','Nó Selho',null,tariffs(.45,.85,1.05,1.20,.32),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','07','Nó Selho','Guimarães Sul',null,tariffs(.50,.90,1.15,1.30,.35),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','08','Guimarães Sul','Nó Calvos',null,tariffs(.50,.90,1.15,1.25,.35),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','09','Nó Calvos','Fafe',null,tariffs(1.10,1.90,2.45,2.70,.77),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','10','Fafe','Basto',null,tariffs(2.20,3.85,4.95,5.50,1.54),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','11','Basto','Ribeira Pena',null,tariffs(1.50,2.60,3.35,3.75,1.05),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A7','12','Ribeira Pena','IP3',null,tariffs(1.55,2.75,3.50,3.90,1.09),{operator:'Ascendi',source:'ascendiTraditional'}),

  section('A11','01','Nó Apúlia','EN205 PV',null,tariffs(.45,.80,1.00,1.10,.32),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','02','EN205','Barcelos',null,tariffs(.95,1.70,2.15,2.40,.67),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','03','Barcelos','Braga Oeste',null,tariffs(1.10,1.95,2.50,2.80,.77),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','04','Braga Oeste','Braga Ferreiros',null,tariffs(.55,.95,1.20,1.35,.39),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','05','Braga Ferreiros','Celeirós',null,tariffs(.40,.70,.90,1.00,.28),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','06','Celeirós','Guimarães Oeste',null,tariffs(1.40,2.45,3.15,3.50,.98),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','07','Nó Selho','Guimarães Oeste',null,tariffs(.20,.35,.45,.50,.14),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','08','Nó Calvos','Vizela',null,tariffs(.80,1.45,1.85,2.05,.56),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','09','Vizela','Felgueiras',null,tariffs(.40,.65,.85,.95,.28),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','10','Longra','Felgueiras',null,tariffs(.20,.40,.50,.55,.14),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','11','Felgueiras','Lousada',null,tariffs(.60,1.05,1.35,1.45,.42),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','12','Lousada','Lousada',null,tariffs(.15,.25,.30,.35,.11),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','13','Lousada','EN15',null,tariffs(.65,1.15,1.50,1.65,.46),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','14','EN15','EN211',null,tariffs(.25,.45,.60,.65,.18),{operator:'Ascendi',source:'ascendiTraditional'}),
  section('A11','15','EN211','Castelões',null,tariffs(.05,.10,.10,.10,.04),{operator:'Ascendi',source:'ascendiTraditional'}),

  // Ascendi electronic point charges. These are charged only when the route
  // actually crosses the gantry.
  gantry('A17','Mira-PonteVagos','Mira / Ponte Vagos',tariffs(.65,1.10,1.40,1.60,.46)),
  gantry('A17','Vagos-Ilhavo','Vagos / Ílhavo',tariffs(.35,.55,.70,.80,.25)),
  gantry('A17','AveiroSul-SBernardo','Aveiro Sul / S. Bernardo',tariffs(.40,.70,.90,1.05,.28)),
  gantry('A29','Salreu-Estarreja','Salreu / Estarreja S/N',tariffs(.65,1.10,1.45,1.65,.46)),
  gantry('A29','Estarreja-Ovar','Estarreja N/S / Ovar',tariffs(.50,.85,1.05,1.20,.35)),
  gantry('A29','Arada-Maceda','Arada / Maceda',tariffs(.45,.85,1.05,1.15,.32)),
  gantry('A29','ER1-18-Miramar','ER1-18 / Miramar',tariffs(.30,.55,.70,.75,.21)),
  gantry('A4','Custoias-ViaNorte','Custóias / Via Norte O/E',tariffs(.15,.25,.35,.35,.11)),
  gantry('A4','ViaNorte-PontePedra','Via Norte E/O / Ponte Pedra',tariffs(.15,.30,.40,.40,.11)),
  gantry('A41','Freixieiro-Aeroporto','Freixieiro / Aeroporto',tariffs(.15,.25,0,0,.11)),
  gantry('A41','Lipor-EN13','Lipor / EN13 O/E',tariffs(.15,.25,0,0,.11)),
  gantry('A41','EN13-EN14','EN13 E/O / EN14 O/E',tariffs(.10,.20,0,0,.07)),
  gantry('A41','EN14-EN107','EN14 E/O / EN107',tariffs(.25,.50,0,0,.18)),
  gantry('A41','Maia-Alfena','Maia / Alfena E/O',tariffs(.10,.20,0,0,.07)),
  gantry('A41','Alfena-SantoTirso','Alfena O/E / Santo Tirso',tariffs(.45,.75,0,0,.32)),
  gantry('A41','Ermida-IC24IC25','Ermida / IC24-IC25 O/E',tariffs(.05,.10,0,0,.04)),
  gantry('A42','IC24IC25-Lordelo','IC24-IC25 E/O / Lordelo',tariffs(.35,.65,.80,.90,.25)),
  gantry('A42','PacosFerreira-EN106Sul','Paços Ferreira / EN106 Sul O/E',tariffs(.35,.60,.75,.85,.25)),
  gantry('A42','EN106Norte-Lousada','EN106 Norte E/O / Lousada',tariffs(.35,.65,.85,1.00,.25)),

  // Bridges are directional toll points: charged south-bank -> Lisbon.
  section('P25ABRIL','01','Almada','Lisboa',6.0,tariffs(2.25,4.85,6.55,8.45),{operator:'Lusoponte',source:'lusoponte25Abril',system:'bridge-plaza',direction:'south-to-north'}),
  section('PVG','01','Montijo','Lisboa',18.0,tariffs(3.40,7.55,11.10,14.20),{operator:'Lusoponte',source:'lusoponteVascoGama',system:'bridge-plaza',direction:'south-to-north'})
]);

// Statutory zero-rated scopes. These entries override old OSM toll tags and
// old tariff data for their validity period.
export const PORTUGAL_ZERO_TOLL_SCOPES_2026 = Object.freeze([
  Object.freeze({ roadRef:'A4', scope:'Transmontana and Túnel do Marão', effectiveFrom:'2025-01-01', source:'lawZeroTolls' }),
  Object.freeze({ roadRef:'A13', scope:'Pinhal Interior', effectiveFrom:'2025-01-01', source:'lawZeroTolls' }),
  Object.freeze({ roadRef:'A13-1', scope:'Pinhal Interior', effectiveFrom:'2025-01-01', source:'lawZeroTolls' }),
  Object.freeze({ roadRef:'A22', scope:'Algarve - entire concession', effectiveFrom:'2025-01-01', source:'lawZeroTolls' }),
  Object.freeze({ roadRef:'A23', scope:'Beira Interior', effectiveFrom:'2025-01-01', source:'lawZeroTolls' }),
  Object.freeze({ roadRef:'A24', scope:'Interior Norte', effectiveFrom:'2025-01-01', source:'lawZeroTolls' }),
  Object.freeze({ roadRef:'A25', scope:'entire motorway including Costa da Prata Aveiro-Albergaria', effectiveFrom:'2026-01-01', source:'lawZeroTolls' }),
  Object.freeze({ roadRef:'A28', scope:'Esposende-Antas', effectiveFrom:'2025-01-01', source:'lawZeroTolls' }),
  Object.freeze({ roadRef:'A28', scope:'Neiva-Darque', effectiveFrom:'2025-01-01', source:'lawZeroTolls' })
]);

// Time-dependent exemptions must be evaluated after the ordinary tariff match.
export const PORTUGAL_TOLL_EXEMPTIONS_2026 = Object.freeze([
  Object.freeze({
    roadRef:'A41',
    scope:'CREP - Freixieiro/Ermida and Ermida/Picoto',
    vehicleClasses:[3,4],
    effectiveFrom:'2026-09-15',
    source:'Decreto-Lei n.º 155-A/2026'
  })
]);

export const PORTUGAL_TOLL_DATASET_2026 = Object.freeze({
  version: PORTUGAL_TOLL_DATASET_VERSION,
  currency: 'EUR',
  sources: PORTUGAL_TOLL_SOURCES,
  sections: PORTUGAL_TOLL_SECTIONS_2026,
  zeroTollScopes: PORTUGAL_ZERO_TOLL_SCOPES_2026,
  exemptions: PORTUGAL_TOLL_EXEMPTIONS_2026
});
