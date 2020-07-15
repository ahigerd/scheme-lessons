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
  if (Array.isArray(expr) && expr.length == 0) {
    return true;
  }
  return expr === false;
}

function isFunction(expr) {
  return !!(expr && typeof expr == 'object' && expr.funcName);
}

function isSymbol(expr) {
  return !!(expr && typeof expr == 'object' && !Array.isArray(expr) && 'symbol' in expr);
}

function resolveSymbolIn(expr, dicts) {
  if (!isSymbol(expr)) {
    return undefined;
  }
  if (!Array.isArray(dicts)) {
    dicts = [dicts];
  }
  for (const dict of dicts) {
    if (expr.symbol in dict) {
      return dict[expr.symbol];
    }
  }
  return undefined;
}

function symbol(name) {
  return { symbol: name };
}

function mustExpand(expr, topLevel = true) {
  if (Array.isArray(expr)) {
    return expr.some(x => mustExpand(x, false));
  } else if (!topLevel && (isFunction(expr) || isSymbol(expr))) {
    return true;
  } else if (resolveSymbolIn(expr, [defs, macros]) !== undefined) {
    return true;
  } else {
    return false;
  }
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

macros['if'] = (function(expr, didStep) {
  if (isFalse(expr[1])) {
    if (expr.length < 3) {
      return false;
    }
    return expr[3];
  } else if (expr[1] === true) {
    return expr[2];
  } else if (didStep) {
    return expr;
  } else {
    const unbound = findUnbound(expr[1]);
    if (unbound.length) {
      throw { doNotExpand: true };
    }
    const result = [...expr];
    result[1] = scmStep(expr[1]).expr;
    return result;
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
  const toString = function() {
    return `<${structName} ${args.map(a => scmStringify(this[a])).join(' ')}>`;
  }
  const isStruct = function(expr) {
    return expr[1] && expr[1].structName == structName;
  };

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
  } else if (expr === true) {
    return '#t';
  } else if (expr === false) {
    return '#f';
  } else if (isFunction(expr)) {
    return expr.funcName;
  } else if (isSymbol(expr)) {
    return expr.symbol;
  } else if (Array.isArray(expr)) {
    return '(' + expr.map(scmStringify).join(' ') + ')';
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
      argSub[args[i].symbol] = expr[i + 1];
      if (argSub[args[i].symbol] === undefined) {
        argSub[args[i].symbol] = false;
      }
    }
  } else if (isSymbol(args)) {
    argSub[args.symbol] = expr.slice(1);
    unpack.push(args.symbol);
  }
  return substitute(argSub, body, unpack);
}

function scmMetaStep(substep, getApply, expr, didStep)
{
  const result = [];
  for (const child of expr) {
    if (didStep) {
      if (child !== undefined) result.push(child);
    } else {
      const childResult = substep(child);
      if (childResult.step) {
        didStep = true;
      }
      if (childResult.expr !== undefined) result.push(childResult.expr);
    }
  }
  if (!didStep && result.length > 0) {
    const apply = getApply(result[0]);
    if (apply) {
      try {
        return { step: true, expr: apply(result, didStep) };
      } catch (err) {
        if (!err.doNotExpand) {
          throw err;
        }
      }
    }
  }
  return { step: didStep, expr: result };
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
  const macro = resolveSymbolIn(expr[0], [macros]);
  if (macro) {
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
    if (step.step) {
      setTimeout(() => scmEvalAsync(step.expr, callback), 0);
    } else {
      callback(step.expr, null);
    }
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
  lastStep = tokenize(el.expr.value);
}

function evaluate()
{
  prepare();
  scmEvalAsync(lastStep, (result, err) => {
    if (err) {
      el.output.innerText = '<div style="color:red;font-weight:bold">' + err.toString() + '</div>';
      console.error(err);
    } else {
      el.output.innerText = result.map(scmStringify).join('\n');
    }
    clearLastStep();
  });
}

function singleStep()
{
  try {
    if (lastStep === undefined) {
      prepare();
    } else {
      el.steps.innerHTML = '<hr/>' + el.output.innerHTML + el.steps.innerHTML;
      const nextStep = [];
      let didStep = false;
      for (const x of lastStep) {
        if (x === undefined) continue;
        if (didStep) {
          nextStep.push(x);
        } else {
          const result = scmStep(x);
          didStep = result.step;
          if (result.expr !== undefined) {
            nextStep.push(result.expr);
          }
        }
      }
      lastStep = nextStep;
    }
    el.output.innerText = lastStep.map(scmStringify).join('\n');
  } catch (err) {
    el.output.innerHTML = '<div style="color:red;font-weight:bold">' + err.toString() + '</div>';
    throw err;
  }
}

function clearLastStep() {
  lastStep = undefined;
}

function saveToLocalStorage() {
  localStorage.defs = el.defs.value;
  localStorage.expr = el.expr.value;
};

evalButton.onclick = evaluate;
stepButton.onclick = singleStep;
saveButton.onclick = saveToLocalStorage;
el.defs.onchange = clearLastStep;
el.expr.onchange = clearLastStep;

el.defs.value = localStorage.defs || '';
el.expr.value = localStorage.expr || '';

scmEval(tokenize("(define-struct posn [x y])"));
