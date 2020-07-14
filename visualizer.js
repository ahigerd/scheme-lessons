const el = {};
for (const id of ['defs', 'expr', 'output', 'steps', 'saveButton', 'evalButton']) {
  el[id] = document.getElementById(id);
}

let lastStep = undefined;
let lastStepString = '';
const defs = {};
const macros = {};

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
  defs[funcName] = { funcName, proc };
}

macros['define'] = function(expr) {
  if (Array.isArray(expr[1])) {
    defs[expr[1][0].symbol] = { funcName: expr[1][0].symbol, args: expr[1].slice(1), body: expr[2] };
  } else {
    defs[expr[1].symbol] = expr[2];
  }
  return undefined;
};

macros['if'] = function(expr) {
  if (isFalse(expr[1])) {
    return expr[3];
  } else if (expr[1] === true) {
    return expr[2];
  } else {
    const result = [...expr];
    result[1] = scmStep(expr[1]).expr;
    return result;
  }
};

defun('not', function(expr) { return isFalse(expr[1]); });
for (const op of ['>', '<', '>=', '<=', '==', '+', '-', '*', '/']) {
  defun(op, eval(`expr => parseFloat(expr[1]) ${op} parseFloat(expr[2])`));
}
defs['='] = defs['=='];

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
      if (ch == '(') {
        parenCount++;
      } else if (ch == ')') {
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
    } else if (ch == '(') {
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

function substitute(subs, body)
{
  if (Array.isArray(body)) {
    const result = [];
    for (const x of body) {
      if (isSymbol(x) && x.symbol in subs) {
        result.push(subs[x.symbol]);
      } else if (Array.isArray(x)) {
        result.push(x.map(y => substitute(subs, y)));
      } else {
        result.push(x);
      }
    }
    return result;
  } else if (isSymbol(body) && body.symbol in subs) {
    return subs[body.symbol];
  } else {
    return body;
  }
}

function scmStringify(expr)
{
  if (expr === true) {
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
  } else {
    const { args, body } = expr[0];
    const argSub = {};
    for (let i = 0; i < args.length; i++) {
      argSub[args[i].symbol] = expr[i + 1];
    }
    return substitute(argSub, body);
  }
}

function scmStep(expr)
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
    return { step: true, expr: macro(expr) };
  }
  const children = expr.map(scmStep);
  const childExprs = children.map(x => x.expr).filter(x => x !== undefined);
  if (children.some(x => x.step)) {
    return { step: true, expr: childExprs };
  } else if (children.length > 0 && isFunction(children[0].expr)) {
    return { step: true, expr: scmApply(childExprs) };
  } else {
    return { step: false, expr };
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
  scmEval(defsExpr);
  lastStep = tokenize(el.expr.value);
}

function evaluate()
{
  prepare();
  const result = scmEval(lastStep);
  el.output.innerText = result.map(scmStringify).join('\n');
}

function singleStep()
{
  if (lastStep === undefined) {
    prepare();
  } else {
    lastStep = lastStep.map(x => scmStep(x).expr).filter(x => x !== undefined);
    el.steps.innerHTML = '<hr/>' + el.output.innerHTML + el.steps.innerHTML;
  }
  el.output.innerText = lastStep.map(scmStringify).join('\n');
}

function saveToLocalStorage() {
  localStorage.defs = el.defs.value;
  localStorage.expr = el.expr.value;
};

evalButton.onclick = evaluate;
stepButton.onclick = singleStep;
saveButton.onclick = saveToLocalStorage;

el.defs.value = localStorage.defs || '';
el.expr.value = localStorage.expr || '';