import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['src/lib/database-url.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {runtimeDatabaseUrl,configuredDatabaseUrl}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
assert.equal(runtimeDatabaseUrl(undefined),undefined);
const pooled=new URL(runtimeDatabaseUrl('postgresql://postgres.fixture:encoded%40password@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require'));
assert.equal(pooled.searchParams.get('pgbouncer'),'true');
assert.equal(pooled.searchParams.get('connection_limit'),'1');
assert.equal(pooled.searchParams.get('sslmode'),'require');
assert.equal(pooled.password,'encoded%40password');
for(const host of ['aws-0-us-east-1.pooler.supabase.com:5432','db.fixture.supabase.co:5432','example.com:6543','aws-0-us-east-1.pooler.supabase.com.evil.example:6543']){
 const url=new URL(runtimeDatabaseUrl(`postgresql://postgres:fixture@${host}/postgres?connection_limit=3`));
 assert.equal(url.searchParams.has('pgbouncer'),false);
 assert.equal(url.searchParams.get('connection_limit'),'3');
}
assert.equal(new URL(runtimeDatabaseUrl('postgresql://postgres:fixture@db.fixture.supabase.co:6543/postgres')).searchParams.get('pgbouncer'),'true');
const prisma=new URL(runtimeDatabaseUrl('postgresql://postgres:fixture@db.prisma.io:5432/postgres'));
assert.equal(prisma.hostname,'pooled.db.prisma.io');
assert.equal(prisma.searchParams.get('pgbouncer'),'true');
console.log('PASS database URL: Supabase transaction prepared statements disabled, session/direct untouched, TLS/password/pool settings preserved, host boundary and existing Prisma behavior verified. No network.');

const supa='postgresql://postgres.fixture:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';
assert.equal(configuredDatabaseUrl({DATABASE_URL:'postgres://fixture:secret@db.prisma.io/postgres',POSTGRES_PRISMA_URL:supa}),supa);
assert.equal(configuredDatabaseUrl({POSTGRES_PRISMA_URL:supa}),supa);
assert.equal(configuredDatabaseUrl({DATABASE_URL:'postgres://localhost/dev',POSTGRES_PRISMA_URL:supa}),'postgres://localhost/dev');
assert.equal(configuredDatabaseUrl({DATABASE_URL:'postgres://db.prisma.io/postgres',POSTGRES_PRISMA_URL:'broken'}),'postgres://db.prisma.io/postgres');
assert.equal(configuredDatabaseUrl({DATABASE_URL:'postgres://db.prisma.io/postgres',POSTGRES_PRISMA_URL:'postgres://evil.example/db'}),'postgres://db.prisma.io/postgres');
console.log('PASS provider selection: verified Supabase integration replaces legacy Prisma only; isolated local databases and invalid/unrelated integration URLs retain explicit precedence.');
