#!/usr/bin/env python3
"""Publish validated tariff data only. Never writes routing graphs or APKs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import quote


def publish(client, bucket, root, namespace="toll-tariffs"):
    if namespace not in ("toll-tariffs","toll-charges"): raise ValueError("Unsupported tariff namespace")
    receipts=[]
    def read(key):
        try:
            response=client.get_object(Bucket=bucket,Key=key)
            return response['Body'].read(),response['ETag']
        except Exception as error:
            if str(getattr(error,"response",{}).get("Error",{}).get("Code")) in ('NoSuchKey','404','NotFound'): return None,None
            raise
    def immutable(key, data, content_type):
        before,_=read(key)
        if before is not None:
            if before!=data: raise ValueError('Immutable tariff collision: '+key)
            return
        client.put_object(Bucket=bucket,Key=key,Body=data,ContentType=content_type,
            CacheControl='public, max-age=31536000, immutable',IfNoneMatch='*')
    for pointer in sorted((root/namespace).glob('*/manifest.json')):
        raw=pointer.read_bytes();manifest=json.loads(raw);country=manifest['country'];version=manifest['revision']
        key=f'{namespace}/{quote(country,safe="")}/manifest.json'
        if manifest.get('scheme','road-average') != ('fixed-crossing' if namespace=='toll-charges' else 'road-average'): raise ValueError('Catalog scheme namespace mismatch')
        table=root/namespace/country/str(version)/'table.csv'
        data=table.read_bytes()
        if hashlib.sha256(data).hexdigest()!=manifest['sha256'] or len(data)!=manifest['sizeBytes']: raise ValueError('Local integrity mismatch')
        if manifest['path']!=f'/{namespace}/{quote(country,safe="")}/{version}/table.csv': raise ValueError('Unsafe object path')
        previous,etag=read(key)
        if previous is not None:
            old=json.loads(previous)
            if old['country']!=country or old['revision']>version: raise ValueError('Remote catalog rollback rejected')
            if old['revision']==version and previous!=raw: raise ValueError('Published manifest collision')
        immutable(manifest['path'].lstrip('/'),data,'text/csv; charset=utf-8')
        immutable(f'{namespace}/{quote(country,safe="")}/{version}/manifest.json',raw,'application/json')
        if previous!=raw:
            conditions={'IfMatch':etag} if etag else {'IfNoneMatch':'*'}
            client.put_object(Bucket=bucket,Key=key,Body=raw,ContentType='application/json',CacheControl='no-store',**conditions)
        check,_=read(key)
        if check!=raw: raise ValueError('Remote publication verification failed')
        receipt=dict(country=country,revision=version,sha256=manifest['sha256'],manifestPath='/'+key,
            validatedCommit=os.environ.get('GITHUB_SHA',''),validatedRun=os.environ.get('GITHUB_RUN_ID',''))
        receipts.append(receipt);print(json.dumps(receipt))
    if not receipts: raise ValueError('No tariff manifests to publish')
    return receipts


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=Path('dist/toll-catalogs'));parser.add_argument('--namespace',default='toll-tariffs');args=parser.parse_args()
    required=['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY']
    if not all(os.environ.get(k) for k in required): raise SystemExit('Existing R2 publishing credentials are required; no tariff data published')
    import boto3
    client=boto3.client('s3',endpoint_url='https://'+os.environ['R2_ACCOUNT_ID']+'.r2.cloudflarestorage.com',
        region_name='auto',aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'])
    receipts=publish(client,'atlas-regions',args.root,args.namespace)
    (args.root/('publication-receipt.json' if args.namespace=='toll-tariffs' else 'publication-receipt-charges.json')).write_text(json.dumps(receipts,indent=2)+'\n')
