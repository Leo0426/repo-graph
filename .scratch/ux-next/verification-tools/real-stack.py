"""Temporary, owned acceptance stack. Never uses the user's app databases or service ports."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse, json, os, secrets, shutil, signal, socket, subprocess, tempfile, time, uuid

ROOT = Path(__file__).resolve().parents[3]
STATE = ROOT / 'repograph-app/build/ux-next/integration/runtime.json'

def save(config):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(config, indent=2))

def setup():
    if STATE.exists():
        raise RuntimeError('A stack manifest already exists. Inspect its live processes before reusing or cleaning it.')
    for port in [17474, 17687, 16343, 16344, 11435, 18080]:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', port))
    nonce = uuid.uuid4().hex
    directory = Path(tempfile.mkdtemp(prefix='repograph-ux-stack-'))
    source = directory / 'synthetic-repository'
    source.mkdir()
    (source / 'Demo.java').write_text('''// Synthetic acceptance source; never executed.
package acceptance;
import java.sql.*;
public class Demo {
    private Connection connection;
    public ResultSet findByName(String name) throws SQLException {
        Statement stmt = connection.createStatement();
        return stmt.executeQuery("SELECT * FROM user WHERE name = '" + name + "'");
    }
}
''')
    password = secrets.token_urlsafe(24)
    app_env = {'REPOGRAPH_ADMIN_PASSWORD': secrets.token_urlsafe(24), 'REPOGRAPH_NEO4J_PASSWORD': password}
    (directory / 'app-env.json').write_text(json.dumps(app_env))
    (directory / 'app-env.json').chmod(0o600)
    (directory / 'neo4j.env').write_text('NEO4J_AUTH=neo4j/' + password + '\n')
    (directory / 'neo4j.env').chmod(0o600)
    config = {'nonce': nonce, 'directory': str(directory), 'source': str(source),
              'neo4j': 'rg-ux-neo4j-' + nonce[:8], 'qdrant': 'rg-ux-qdrant-' + nonce[:8],
              'collection': 'ux_acceptance_' + nonce, 'appPid': None, 'embeddingPid': None}
    save(config)
    commands = [
        ['docker','run','--detach','--rm','--pull=never','--name',config['neo4j'],
         '--label','repograph.ux.acceptance='+nonce,'--memory=768m','--cpus=2',
         '--env-file',str(directory/'neo4j.env'),
         '-e','NEO4J_server_memory_heap_initial__size=128m','-e','NEO4J_server_memory_heap_max__size=256m',
         '-e','NEO4J_server_memory_pagecache_size=128m',
         '-p','127.0.0.1:17474:7474','-p','127.0.0.1:17687:7687','neo4j:5'],
        ['docker','run','--detach','--rm','--pull=never','--name',config['qdrant'],
         '--label','repograph.ux.acceptance='+nonce,'--memory=384m','--cpus=1',
         '-p','127.0.0.1:16343:6333','-p','127.0.0.1:16344:6334','qdrant/qdrant:latest'],
    ]
    for command in commands:
        subprocess.run(command, check=True, capture_output=True, text=True)
    print(json.dumps(config), flush=True)

def embedding(config):
    config['embeddingPid'] = os.getpid();save(config)
    counts = {}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def reply(self, data, status=200):
            encoded=json.dumps(data).encode();self.send_response(status)
            self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(encoded)))
            self.end_headers();self.wfile.write(encoded)
        def do_GET(self):
            if self.path == '/__requests': return self.reply(counts)
            counts[self.path]=counts.get(self.path,0)+1
            if self.path == '/api/tags': return self.reply({'models':[{'name':'ux-embedding-fixture','model':'ux-embedding-fixture'}]})
            self.reply({'error':'Unsupported test endpoint'},404)
        def do_POST(self):
            counts[self.path]=counts.get(self.path,0)+1
            if self.headers.get('Transfer-Encoding','').lower() == 'chunked':
                chunks=[];total=0
                while True:
                    size=int(self.rfile.readline().split(b';',1)[0],16)
                    if not size:
                        while self.rfile.readline().strip(): pass
                        break
                    total+=size
                    if total>1024*1024: return self.reply({'error':'Fixture input too large'},413)
                    chunks.append(self.rfile.read(size));self.rfile.read(2)
                body=b''.join(chunks)
            else:
                size=int(self.headers.get('Content-Length','0'))
                if size>1024*1024:return self.reply({'error':'Fixture input too large'},413)
                body=self.rfile.read(size)
            data=json.loads(body)
            if self.path != '/api/embed': return self.reply({'error':'Generation is forbidden in this acceptance stack'},503)
            inputs=data.get('input',[]);inputs=[inputs] if isinstance(inputs,str) else inputs
            self.reply({'embeddings':[[1.0]+[0.0]*63 for _ in inputs]})
    print('Deterministic embedding substitute ready on 127.0.0.1:11435',flush=True)
    ThreadingHTTPServer(('127.0.0.1',11435),Handler).serve_forever()

def app(config):
    directory=Path(config['directory']);env=os.environ.copy();env.pop('REPOGRAPH_PROVIDER_ENCRYPTION_KEY',None)
    env.update(json.loads((directory/'app-env.json').read_text()))
    jar=ROOT/'repograph-app/build/ux-next/candidate/repograph-app-0.5.0.jar'
    args=['java','--enable-native-access=ALL-UNNAMED','-Duser.home='+str(directory/'home'),'-jar',str(jar),
          '--server.address=127.0.0.1','--server.port=18080',
          '--repograph.index.db-path='+str(directory/'data/repograph.db'),
          '--repograph.neo4j.uri=bolt://localhost:17687','--repograph.neo4j.user=neo4j',
          '--repograph.qdrant.host=localhost','--repograph.qdrant.port=16344',
          '--repograph.qdrant.collection='+config['collection'],'--repograph.qdrant.vector-size=64',
          '--repograph.ollama.base-url=http://127.0.0.1:11435','--repograph.ollama.model=ux-embedding-fixture',
          '--repograph.ollama.timeout-seconds=5','--repograph.advisory.enabled=false',
          '--repograph.advisory.ollama.base-url=http://127.0.0.1:11435']
    with (directory/'app.log').open('w') as output:
        process=subprocess.Popen(args,cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT)
        config['appPid']=process.pid;save(config)
        print('Isolated packaged app PID '+str(process.pid),flush=True)
        raise SystemExit(process.wait())

def cleanup(config):
    for key, expected in [('appPid','-Duser.home='+config['directory']+'/home'),('embeddingPid',str(Path(__file__).resolve())+' embed')]:
        pid=config.get(key)
        if not pid:continue
        result=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True)
        if result.returncode:continue
        if expected not in result.stdout:raise RuntimeError('PID identity mismatch; refusing to stop '+key)
        os.kill(pid,signal.SIGTERM)
        for _ in range(50):
            if subprocess.run(['ps','-p',str(pid)],capture_output=True).returncode:break
            time.sleep(.1)
        else:raise RuntimeError('Process did not stop: '+key)
    for key in ['neo4j','qdrant']:
        result=subprocess.run(['docker','inspect',config[key]],capture_output=True,text=True)
        if result.returncode:continue
        instance=json.loads(result.stdout)[0]
        if instance['Config']['Labels'].get('repograph.ux.acceptance')!=config['nonce']:
            raise RuntimeError('Container ownership mismatch')
        subprocess.run(['docker','rm','--force','--volumes',config[key]],check=True,capture_output=True)
    shutil.rmtree(config['directory']);STATE.unlink()
    print('Removed only the owned acceptance processes, containers, anonymous volumes and temporary credentials.')

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['setup','embed','app','cleanup']);action=parser.parse_args().action
    if action=='setup':setup()
    else:
        config=json.loads(STATE.read_text())
        {'embed':embedding,'app':app,'cleanup':cleanup}[action](config)
