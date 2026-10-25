#!/usr/bin/env python3
"""Read public IMT facts; never query Via Verde's private calculator endpoints."""
import argparse, collections, csv, hashlib, io, json, re, urllib.request
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path

SOURCE="https://www.imt-ip.pt/rodoviario/infraestruturas-rodoviarias/rede-rodoviaria/taxas-de-portagem/"
class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.tables=[];self.rows=None;self.row=None;self.cell=None
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=="table": self.rows=[]
        elif tag=="tr" and self.rows is not None:self.row=[]
        elif tag in ("td","th") and self.row is not None:
            self.cell=["",int(attrs.get("rowspan","1")),int(attrs.get("colspan","1"))]
        elif tag=="br" and self.cell is not None:self.cell[0]+=" "
    def handle_data(self,data):
        if self.cell is not None:self.cell[0]+=data
    def handle_endtag(self,tag):
        if tag in ("td","th") and self.cell is not None:
            self.cell[0]=" ".join(self.cell[0].split());self.row.append(self.cell);self.cell=None
        elif tag=="tr" and self.row is not None:self.rows.append(self.row);self.row=None
        elif tag=="table" and self.rows is not None:self.tables.append(self.rows);self.rows=None

def expand(rows):
    pending={}
    for raw in rows:
        row={col:text for col,(text,left) in pending.items()}
        pending={col:(text,left-1) for col,(text,left) in pending.items() if left>1}
        col=0
        for text,rs,cs in raw:
            while col in row:col+=1
            for n in range(cs):
                row[col+n]=text
                if rs>1:pending[col+n]=(text,rs-1)
            col+=cs
        yield [row.get(i,"") for i in range(max(row,default=-1)+1)]

def parse(html):
    p=Tables();p.feed(html)
    records=[];unmapped=[];tables=[]
    for raw in p.tables:
        road=None;count=0
        for f in expand(raw):
            if len(f)<7 or not all(re.fullmatch(r"\d+(?:,\d+)?",x) for x in f[-5:]):continue
            match=re.match(r"^A\s*(\d+)(?:\b|/)",f[0])
            if match:road="A"+match[1]
            section=f[-6]
            if not section or section.lower()=="total":continue
            values=[format(Decimal(x.replace(",",".")),"f") for x in f[-5:]]
            if not road:
                unmapped.append({"section":section,"km":values[0],"classes":values[1:],
                                 "reason":"Fixed plaza/bridge: road-wide distance pricing is inappropriate"})
                continue
            assert ";" not in section and Decimal(values[0])>0
            records.append([road,section,*values]);count+=1
        if count:tables.append({"road":road,"rows":count})
    assert records and len(records)>50,"No complete 2026 IMT section tables found"
    identities=[(r[0],r[1]) for r in records]
    assert len(identities)==len(set(identities)),"Duplicate road/section in official page"
    return records,unmapped,tables

def main():
    a=argparse.ArgumentParser();a.add_argument("--html");a.add_argument("--out",required=True);args=a.parse_args()
    out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
    if args.html:raw=Path(args.html).read_bytes()
    else:
        req=urllib.request.Request(SOURCE,headers={"User-Agent":"Atlas-Tariff-Audit/1.0"})
        with urllib.request.urlopen(req,timeout=45) as response:raw=response.read(5*1024*1024+1)
    assert len(raw)<=5*1024*1024
    html=raw.decode("utf-8");assert "2026" in html
    records,unmapped,tables=parse(html)
    (out/"imt-2026.html").write_bytes(raw)
    output=io.StringIO();output.write("# atlas-toll-table-v1\n# country=Portugal\n# currency=EUR\n# year=2026\n# version=2026102501\n# fractionDigits=2\n# source="+SOURCE+"\n")
    writer=csv.writer(output,delimiter=";",lineterminator="\n")
    writer.writerow(["road","section","km","class1","class2","class3","class4"]);writer.writerows(records)
    (out/"Portugal.csv").write_text(output.getvalue())
    audit={"source":SOURCE,"sourceSha256":hashlib.sha256(raw).hexdigest(),"year":2026,
           "rows":len(records),"tables":tables,"unmapped":unmapped,
           "scope":"Published HTML section tariffs only, not a full national inventory or a Via Verde journey quote"}
    (out/"audit.json").write_text(json.dumps(audit,ensure_ascii=False,indent=2))
    print("ATLAS_IMT_AUDIT "+json.dumps(audit,ensure_ascii=False))
    print("ATLAS_IMT_CSV_BEGIN\n"+output.getvalue()+"ATLAS_IMT_CSV_END")
if __name__=="__main__":main()
