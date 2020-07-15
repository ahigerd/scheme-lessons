const el = {};
for (const id of ['defs', 'expr', 'output', 'steps', 'saveButton', 'evalButton']) {
  el[id] = document.getElementById(id);
}

let lastStep = undefined;
let lastStepString = '';
const staticDefs = {};
const macros = {};
let defs = {};

function isFalse(expr) {
  return expr === false || (Array.isArray(expr) && expr.length == 0);
}

function isFunction(expr) {
  return !!(expr && typeof expr == 'object' && expr.funcName);
}

function isSymbol(expr) {
  return !!(expr && typeof expr == 'object' && !Array.isArray(expr) && 'symbol' in expr);
}

function resolveSymbolIn(expr, dicts) {
  if (isSymbol(expr)) {
    for (const dict of dicts) {
      if (expr.symbol in dict) {
        return dict[expr.symbol];
      }
    }
  }
  return undefined;
}

function symbol(name) {
  return { symbol: name };
}

function defun(funcName, proc) {
  staticDefs[funcName] = { funcName, proc };
}

macros['define'] = function(expr) {
  if (Array.isArray(expr[1])) {
    defs[expr[1][0].symbol] = { funcName: expr[1][0].symbol, args: expr[1].slice(1), body: expr[2] };
  } else {
    defs[expr[1].symbol] = expr[2];
  }
  return undefined;
};

macros['lambda'] = function(expr) {
  return {
    funcName: '<lambda>',
    args: expr[1],
    body: expr[2],
    toString: function() { return `<lambda ${scmStringify(this.args)} ${scmStringify(this.body)}>`; },
  };
};

function findUnbound(expr, args = [])
{
  if (Array.isArray(expr)) {
    return [].concat(...expr.map(x => findUnbound(x, args)));
  } else if (isFunction(expr) && expr.body) {
    const childArgs = [...args, ...expr.args.map(x => x.symbol)];
    return [].concat(...expr.body.map(x => findUnbound(x, childArgs)));
  } else if (isSymbol(expr) && !args.includes(expr.symbol) && !(expr.symbol in defs)) {
    return [expr.symbol];
  } else {
    return [];
  }
}

macros['if'] = (function(expr) {
  if (isFalse(expr[1])) {
    return expr.length < 3 ? false : expr[3];
  } else if (expr[1] === true) {
    return expr[2];
  } else {
    if (findUnbound(expr[1]).length) {
      throw { doNotExpand: true };
    }
    return [ expr[0], scmStep(expr[1]).expr, ...expr.slice(2) ];
  }
});

macros['apply'] = (function(expr) {
  let fn = expr[1];
  const args = expr.slice(2);
  if (isSymbol(fn)) {
    fn = resolveSymbolIn(fn, [defs]);
  } else if (Array.isArray(fn) && fn.length > 0) {
    if (isSymbol(fn[0])) {
      fn = [resolveSymbolIn(fn[0], [defs]), ...fn.slice(1)];
    }
    if (isFunction(fn[0])) {
      return [expr[0], scmStep(fn).expr, ...args];
    }
  }
  if (!isFunction(fn) || !Array.isArray(args)) {
    throw { doNotExpand: true };
  }
  return [ fn, ...args ];
});

macros['list'] = function(expr) {
  return expr.slice(1);
}

macros['define-struct'] = function(expr) {
  const structName = expr[1].symbol;
  const args = expr[2].map(x => x.symbol);
  const toString = function() { return `<${structName} ${args.map(a => scmStringify(this[a])).join(' ')}>`; }
  const isStruct = function(expr) { return expr[1] && expr[1].structName == structName; };

  defun(`make-${structName}`, function(expr) {
    const obj = { structName, toString };
    for (let i = 0; i < args.length; i++) {
      obj[args[i]] = expr[i + 1];
    }
    return obj;
  });

  defun(`${structName}?`, isStruct);

  for (const arg of args) {
    defun(`${structName}-${arg}`, function(expr) {
      if (!isStruct(expr)) {
        throw new Error(`${structName}-${arg} expected ${structName}, got ${scmStringify(expr[1])}`);
      }
      return expr[1][arg];
    });
  }
}

defun('not', function(expr) { return isFalse(expr[1]); });
for (const op of ['>', '<', '>=', '<=', '==', '+', '-', '*', '/']) {
  defun(op, eval(`expr => parseFloat(expr[1]) ${op} parseFloat(expr[2])`));
}
staticDefs['='] = staticDefs['=='];

function makeBinding(name, jsValue)
{
  if (jsValue && jsValue.apply) {
    defun(name, expr => jsValue.apply(null, expr.slice(1)));
  } else {
    staticDefs[name] = jsValue;
  }
}
for (const mathFn of Object.getOwnPropertyNames(Math)) {
  makeBinding(mathFn, Math[mathFn]);
}

function bakeToken(token)
{
  if (token == '#t' || token == '#true') {
    return true;
  } else if (token == '#f' || token == '#false') {
    return false;
  } else if (token[0] == '"' && token[token.length - 1] == '"') {
    return token.substr(1, token.length - 2);
  } else {
    const floatVal = parseFloat(token);
    return isNaN(floatVal) ? symbol(token) : floatVal;
  }
}

function tokenize(expr)
{
  expr = expr.replace(/\s+/g, ' ');
  const len = expr.length;
  const ast = [];
  let tokenStart = false;
  let parenCount = 0;
  let inString = false;
  for (let i = 0; i < len; i++) {
    let ch = expr[i];
    if (inString) {
      if (ch == '"') {
        ast.push(expr.substring(tokenStart, i + 1));
        inString = false;
        tokenStart = false;
      } else if (ch == '\\') {
        i++;
      }
    } else if (parenCount > 0) {
      if (ch == '(' || ch == '[') {
        parenCount++;
      } else if (ch == ')' || ch == ']') {
        parenCount--;
        if (parenCount == 0) {
          ast.push(tokenize(expr.substring(tokenStart, i)));
          tokenStart = false;
        }
      }
    } else if (ch == ' ' || ch == '"') {
      if (tokenStart !== false) {
        ast.push(bakeToken(expr.substring(tokenStart, i)));
      }
      if (ch == '"') {
        tokenStart = i;
      } else {
        tokenStart = false;
      }
    } else if (ch == '(' || ch == '[') {
      parenCount = 1;
      tokenStart = i + 1;
    } else if (tokenStart === false) {
      tokenStart = i;
    }
  }
  if (tokenStart !== false) {
    ast.push(bakeToken(expr.substring(tokenStart)));
  }
  return ast.map(token => {
    if (token == '#t' || token == '#true') {
      return true;
    } else if (token == '#f' || token == '#false') {
      return false;
    } else {
      const floatVal = parseFloat(token);
      return isNaN(floatVal) ? token : floatVal;
    }
  });
}

function substitute(subs, body, unpack = [])
{
  if (Array.isArray(body)) {
    const result = [];
    for (const x of body) {
      if (isSymbol(x) && x.symbol in subs) {
        if (unpack.includes(x.symbol)) {
          result.push(...subs[x.symbol]);
        } else {
          result.push(subs[x.symbol]);
        }
      } else {
        result.push(substitute(subs, x, unpack));
      }
    }
    return result;
  } else if (isFunction(body) && body.body) {
    const lambdaSubs = {};
    const shadow = isSymbol(body.args) ? [body.args.symbol] : body.args.map(x => x.symbol);
    for (const sub in subs) {
      if (!shadow.includes(sub)) {
        lambdaSubs[sub] = subs[sub];
      }
    }
    return macros.lambda([null, body.args, substitute(lambdaSubs, body.body, unpack)]);
  } else if (isSymbol(body) && body.symbol in subs) {
    return subs[body.symbol];
  } else {
    return body;
  }
}

function scmStringify(expr)
{
  if (expr === undefined) {
    console.trace('???');
    return '';
  } else if (expr.hasOwnProperty('toString')) {
    return expr.toString();
  } else if (typeof expr == 'boolean') {
    return `#${expr}`;
  } else if (isFunction(expr)) {
    return expr.funcName;
  } else if (isSymbol(expr)) {
    return expr.symbol;
  } else if (Array.isArray(expr)) {
    return `(${expr.map(scmStringify).join(' ')})`;;
  } else {
    return JSON.stringify(expr);
  }
}

function scmApply(expr)
{
  if (expr[0].proc) {
    return expr[0].proc(expr);
  }
  const { args, body } = expr[0];
  const argSub = {};
  const unpack = [];
  if (Array.isArray(args)) {
    for (let i = 0; i < args.length; i++) {
      argSub[args[i].symbol] = (expr[i + 1] === undefined) ? false : expr[i + 1];
    }
  } else if (isSymbol(args)) {
    argSub[args.symbol] = expr.slice(1);
    unpack.push(args.symbol);
  }
  return substitute(argSub, body, unpack);
}

function scmMetaStep(substep, getApply, expr, didStep)
{
  let result = [];
  for (const child of expr) {
    if (didStep) {
      result.push(child);
    } else {
      const childResult = substep(child);
      didStep = didStep || childResult.step;
      result.push(childResult.expr);
    }
  }
  result = result.filter(x => x !== undefined);
  if (!didStep && result.length > 0) {
    try {
      const apply = getApply(result[0]);
      if (apply) {
        result = apply(result);
        didStep = true;
      }
    } catch (err) {
      if (!err.doNotExpand) {
        throw err;
      }
    }
  }
  return { step: didStep, expr: Array.isArray(result) ? result.filter(x => x !== undefined) : result };
}

function scmMacroStep(expr, didStep = false)
{
  if (!Array.isArray(expr)) {
    return { step: false, expr };
  }
  return scmMetaStep(
    scmMacroStep,
    symbol => resolveSymbolIn(symbol, [macros]),
    expr,
    didStep,
  );
}

function scmStep(expr, didStep = false)
{
  if (!Array.isArray(expr)) {
    if (expr && typeof expr == 'object' && expr.quote) {
      return { step: false, expr };
    }
    const resolved = resolveSymbolIn(expr, [defs]);
    const didResolve = resolved !== undefined;
    // Replacing a symbol with a function would result in a "step" that isn't visible
    return { step: didResolve && !isFunction(resolved), expr: didResolve ? resolved : expr };
  }
  if (resolveSymbolIn(expr[0], [macros])) {
    return scmMacroStep(expr);
  }
  return scmMetaStep(
    scmStep,
    obj => isFunction(obj) ? scmApply : null,
    expr,
    didStep,
  );
}

function scmEvalAsync(expr, callback)
{
  try {
    const step = scmStep(expr);
    setTimeout(() => callback(step, null), 0);
  } catch (err) {
    callback(null, err);
  }
}

function scmEval(expr)
{
  let lastStep = { step: true, expr };
  do {
    lastStep = scmStep(lastStep.expr);
  } while (lastStep.step);
  return lastStep.expr;
}

function prepare()
{
  el.steps.innerHTML = '';
  let defsExpr = tokenize(el.defs.value);
  defs = Object.create(staticDefs);
  scmEval(defsExpr);
  return lastStep = tokenize(el.expr.value);
}

function showError(err)
{
  el.output.innerText = '<div style="color:red;font-weight:bold">' + err.toString() + '</div>';
  console.error(err);
}

function showResult(result)
{
  el.output.innerText = (result || []).map(scmStringify).join('\n');
}

function appendStep(result)
{
  el.steps.innerHTML = (el.output.innerHTML || el.steps.innerHTML ? '<hr/>' : '') + el.output.innerHTML + el.steps.innerHTML;
  lastStep = result.expr;
  showResult(lastStep);
}

function singleStep(callback = null)
{
  if (!callback) callback = appendStep;
  if (lastStep === undefined) prepare();
  scmEvalAsync(lastStep, (result, err) => (err ? showError(err) : callback(result)));
}

function evaluate()
{
  el.steps.innerHTML = '';
  el.output.innerHTML = '';
  prepare();
  const step = () => scmEvalAsync(lastStep, (result, err) => {
    if (err) {
      showError(err);
    } else if (result.step) {
      lastStep = result.expr;
      step();
    } else {
      showResult(result.expr);
      clearLastStep();
    }
  });
  step();
}

function clearLastStep() {
  lastStep = undefined;
}

function saveToLocalStorage() {
  localStorage.defs = el.defs.value;
  localStorage.expr = el.expr.value;
};

evalButton.onclick = evaluate;
stepButton.onclick = () => singleStep();
saveButton.onclick = saveToLocalStorage;
el.defs.onchange = clearLastStep;
el.expr.onchange = clearLastStep;

el.defs.value = localStorage.defs || '';
el.expr.value = localStorage.expr || '';

scmEval(tokenize("(define-struct posn [x y])"));
