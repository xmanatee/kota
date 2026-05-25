// REPL wrapper scripts and protocol constants for code_exec sessions.
// Extracted from code-exec.ts to keep that module under 300 lines.

export const SENTINEL = "__KOTA_EXEC__";
export const DONE_MARKER = "__KOTA_DONE__";
export const ENV_MARKER = "__KOTA_ENV__";
export const DEFAULT_TIMEOUT = 30_000;
export const MAX_OUTPUT = 50_000;

// Python wrapper: reads code blocks delimited by SENTINEL, executes them,
// prints DONE_MARKER after each. State accumulates in _g dict.
// Uses AST to extract and display the last expression's value (like IPython).
export const PYTHON_WRAPPER = [
  "import sys, traceback, ast, json",
  "import os as _os; _os.environ['MPLBACKEND']='Agg'",
  "def _kota_owned_env(_k): return _k in ('KOTA_SESSION_ID','KOTA_TOOL_USE_ID') or _k.startswith('OTEL_') or _k.startswith('OTLP_')",
  "def _kota_apply_env(_payload):",
  "    for _k in list(_os.environ.keys()):",
  "        if _kota_owned_env(_k): _os.environ.pop(_k, None)",
  "    for _k, _v in _payload.items(): _os.environ[_k] = str(_v)",
  "_g = {}",
  "while True:",
  "    lines = []",
  "    while True:",
  "        line = sys.stdin.readline()",
  "        if not line: sys.exit(0)",
  `        if line.rstrip('\\n') == '${SENTINEL}': break`,
  "        lines.append(line)",
  `    if lines and lines[0].startswith('${ENV_MARKER}:'):`,
  `        _kota_apply_env(json.loads(lines.pop(0)[len('${ENV_MARKER}:'):]))`,
  "    code = ''.join(lines)",
  "    try:",
  "        try:",
  "            r = eval(compile(code, '<exec>', 'eval'), _g)",
  "            if r is not None: print(repr(r))",
  "        except SyntaxError:",
  "            tree = ast.parse(code)",
  "            if tree.body and isinstance(tree.body[-1], ast.Expr):",
  "                last = tree.body.pop()",
  "                if tree.body:",
  "                    exec(compile(tree, '<exec>', 'exec'), _g)",
  "                expr = ast.Expression(body=last.value)",
  "                ast.fix_missing_locations(expr)",
  "                r = eval(compile(expr, '<exec>', 'eval'), _g)",
  "                if r is not None: print(repr(r))",
  "            else:",
  "                exec(compile(code, '<exec>', 'exec'), _g)",
  "    except KeyboardInterrupt:",
  "        print('KeyboardInterrupt: execution interrupted')",
  "    except Exception: traceback.print_exc()",
  "    try:",
  "        import matplotlib.pyplot as _plt",
  "        if _plt.get_fignums():",
  "            import tempfile as _tf",
  "            for _fn in _plt.get_fignums()[:5]:",
  "                _p=_tf.mktemp(suffix='.png',prefix='kota_');_plt.figure(_fn).savefig(_p,dpi=150,bbox_inches='tight');print(f'__KOTA_PLOT__:{_p}')",
  "            _plt.close('all')",
  "    except Exception: pass",
  `    sys.stdout.write('${DONE_MARKER}\\n')`,
  "    sys.stdout.flush()",
].join("\n");

// Node.js wrapper: same protocol, uses vm.runInContext for state persistence.
export const NODE_WRAPPER = [
  "const rl=require('readline').createInterface({input:process.stdin,terminal:false});",
  "const vm=require('vm');",
  "const kotaOwnedEnv=k=>k==='KOTA_SESSION_ID'||k==='KOTA_TOOL_USE_ID'||k.startsWith('OTEL_')||k.startsWith('OTLP_');",
  "const applyKotaEnv=payload=>{for(const k of Object.keys(process.env)){if(kotaOwnedEnv(k))delete process.env[k];}for(const [k,v]of Object.entries(payload)){process.env[k]=String(v);}};",
  "const ctx=vm.createContext({...globalThis,require,console,process,Buffer,",
  "setTimeout,setInterval,clearTimeout,clearInterval});",
  "let lines=[];",
  "rl.on('line',l=>{",
  `  if(l==='${SENTINEL}'){`,
  `    if(lines[0]&&lines[0].startsWith('${ENV_MARKER}:'))applyKotaEnv(JSON.parse(lines.shift().slice('${ENV_MARKER}:'.length)));`,
  "    const code=lines.join('\\n');lines=[];",
  "    try{",
  "      const r=vm.runInContext(code,ctx,{filename:'<exec>'});",
  "      if(r!==undefined){",
  "        const s=typeof r==='object'?JSON.stringify(r,null,2):String(r);",
  "        process.stdout.write(s+'\\n');",
  "      }",
  "    }catch(e){process.stderr.write((e.stack||String(e))+'\\n')}",
  `    process.stdout.write('${DONE_MARKER}\\n');`,
  "    return;",
  "  }",
  "  lines.push(l);",
  "});",
  "rl.on('close',()=>process.exit(0));",
].join("");
