// The hard set: longer programs in which several traps interact, so the whole output is right only if every one is.
// Answers are what the programs print (lines joined by single spaces), checked with `node bench/run.mjs --verify`.
export const HARD = [
  {
    id: 'h-js-loop-mix', lang: 'js',
    answer: "a1 n1 p1 a2 q1 p3 p2 t1 t2 a3",
    code: `const log = [];
setTimeout(() => log.push('t1'), 0);
Promise.resolve().then(() => {
  log.push('p1');
  setTimeout(() => log.push('t2'), 0);
  Promise.resolve().then(() => log.push('p2'));
});
(async () => {
  log.push('a1');
  await undefined;
  log.push('a2');
  await new Promise(r => setTimeout(r, 0));
  log.push('a3');
})();
process.nextTick(() => {
  log.push('n1');
  Promise.resolve().then(() => log.push('p3'));
});
queueMicrotask(() => log.push('q1'));
setTimeout(() => console.log(log.join(' ')), 20);`,
  },
  {
    id: 'h-js-object-keys', lang: 'js',
    answer: "0,1,2,a,-1,01,1.5,b {\"n\":null,\"d\":\"1970-01-01T00:00:00.000Z\",\"nested\":\"J\",\"arr\":[null,null]}",
    code: `const o = { b: 1, 2: 'two', a: 2, '1': 'one', [-1]: 'neg', '01': 'zero-one', 1.5: 'x' };
o[0] = 'zero';
delete o.b;
o.b = 3;
console.log(Object.keys(o).join(','));
console.log(JSON.stringify({ u: undefined, f() {}, n: NaN, d: new Date(0), nested: { toJSON() { return 'J'; } }, arr: [undefined, () => 1] }));`,
  },
  {
    id: 'h-js-tdz-hoisting', lang: 'js',
    answer: "ReferenceError undefined g2 13",
    code: `const out = [];
try { out.push(typeof x); let x = 1; } catch (e) { out.push(e.constructor.name); }
out.push(typeof y);
var y = 2;
function f() { return g(); function g() { return 'g1'; } function g() { return 'g2'; } }
out.push(f());
const fns = [];
for (let i = 0; i < 3; i++) { fns.push(() => i); i++; }
out.push(fns.map(fn => fn()).join(''));
console.log(out.join(' '));`,
  },
  {
    id: 'h-js-numbers', lang: 'js',
    answer: "31 1 1000 0.5 0 12 NaN 0 1 NaN 0.30000000000000004 9007199254740992 true",
    code: `console.log([parseInt('0x1F'), parseInt('1e3'), Number('1e3'), parseFloat('.5.5'), Number(''), Number(' 12 '), Number('12px'),
  +[], +[1], +[1, 2], 0.1 * 3, 9007199254740993, 2 ** 53 + 1 === 2 ** 53].join(' '));`,
  },
  {
    id: 'h-js-class-fields', lang: 'js',
    answer: "100 200 v true false",
    code: `class A {
  constructor() { this.v = 1; this.init(); }
  init() { this.v += 10; }
  get double() { return this.v * 2; }
}
class B extends A {
  v = 100;
  init() { this.v += 1; }
}
const b = new B();
console.log(b.v, b.double, Object.keys(b).join(','), 'double' in b, Object.hasOwn(b, 'double'));`,
  },
  {
    id: 'h-js-strings-regex', lang: 'js',
    answer: "aaaBbbCcc 5 2 aaab abx 3 4",
    code: `const s = 'aaa-bbb-ccc';
console.log(s.replace(/-(\\w)/g, (m, c) => c.toUpperCase()), s.split(/(-)/).length, 'abcabc'.lastIndexOf('c', 3),
  /a*?b/.exec('aaab')[0], 'x'.padStart(3, 'ab'), [...'a😀b'].length, 'a😀b'.length);`,
  },
  {
    id: 'h-js-labels', lang: 'js',
    answer: "abbc",
    code: `let out = '';
outer: for (let i = 0; i < 3; i++) {
  switch (i) {
    case 0: out += 'a';
    case 1: out += 'b'; continue outer;
    default: out += 'c'; break outer;
  }
  out += 'x';
}
console.log(out);`,
  },
  {
    id: 'h-js-async-errors', lang: 'js',
    answer: "f-finally | caught-await | then g | rf | fast | outer x",
    code: `const out = [];
async function f() { try { return Promise.reject(new Error('x')); } catch { out.push('caught-return'); } finally { out.push('f-finally'); } }
async function g() { try { return await Promise.reject(new Error('y')); } catch { out.push('caught-await'); return 'g'; } }
f().catch(e => out.push('outer ' + e.message));
g().then(v => out.push('then ' + v));
Promise.allSettled([Promise.reject(1), 2]).then(r => out.push(r.map(x => x.status[0]).join('')));
Promise.race([new Promise(r => setTimeout(() => r('slow'), 5)), Promise.resolve('fast')]).then(v => out.push(v));
setTimeout(() => console.log(out.join(' | ')), 20);`,
  },
  {
    id: 'h-js-array-holes', lang: 'js',
    answer: "3 2//6 2 02 [1,null,3] true -1 01 -- 1",
    code: `const a = [1, , 3];
const out = [a.length, a.map(x => x * 2).join('/'), a.filter(() => true).length, Object.keys(a).join(''), JSON.stringify(a),
  [...a].includes(undefined), a.indexOf(undefined), Array.from({ length: 2 }).map((_, i) => i).join(''), Array(3).join('-'), [,].length];
console.log(out.join(' '));`,
  },
  {
    id: 'h-js-sort-comparator', lang: 'js',
    answer: "bcad 312 1,10,9,B,a,b 1,10,5 true,false",
    code: `const people = [{ n: 'b', a: 30 }, { n: 'a', a: 25 }, { n: 'c', a: 30 }, { n: 'd', a: 25 }];
console.log(people.sort((x, y) => y.a - x.a).map(p => p.n).join(''),
  [3, 1, 2].sort((x, y) => x > y).join(''),
  ['10', '9', '1', 'a', 'B', 'b'].sort().join(','),
  [10, 1, 5].toSorted().join(','), [-0, 0].sort((x, y) => x - y).map(v => Object.is(v, -0)).join(','));`,
  },
  {
    id: 'h-py-class-attr', lang: 'python',
    answer: "2 1 0 [1, 2, 3] True",
    code: `class C:
    items = []
    count = 0
    def add(self, x):
        self.items.append(x)
        self.count += 1

a, b = C(), C()
a.add(1); b.add(2); a.add(3)
print(a.count, b.count, C.count, C.items, a.items is b.items)`,
  },
  {
    id: 'h-py-eq-hash', lang: 'python',
    answer: "1 1 True TypeError {1: 'float'}",
    code: `class P:
    def __init__(self, x): self.x = x
    def __eq__(self, o): return isinstance(o, P) and self.x == o.x

print(len({1, 1.0, True}), len({0, False, 0.0, -0.0}), P(1) == P(1))
try:
    {P(1)}
except TypeError:
    print('TypeError')
print({1: 'int', True: 'bool', 1.0: 'float'})`,
  },
  {
    id: 'h-py-yield-from', lang: 'python',
    answer: "0 5 12 returned 120 end",
    code: `def gen():
    total = 0
    while True:
        x = yield total
        if x is None:
            return total * 10
        total += x

def outer():
    r = yield from gen()
    yield f'returned {r}'

g = outer()
print(next(g), g.send(5), g.send(7), next(g), next(g, 'end'))`,
  },
  {
    id: 'h-py-mutate-iterating', lang: 'python',
    answer: "[1, 4, 5, 8] RuntimeError 3",
    code: `nums = [1, 2, 4, 5, 6, 8]
for n in nums:
    if n % 2 == 0:
        nums.remove(n)
print(nums)
d = {'a': 1, 'b': 2}
try:
    for k in d:
        d[k + k] = 0
except RuntimeError:
    print('RuntimeError')
print(len(d))`,
  },
  {
    id: 'h-py-scopes', lang: 'python',
    answer: "('i', ['i']) g NameError",
    code: `x = 'g'
def outer():
    x = 'o'
    def inner():
        nonlocal x
        x = 'i'
        return [x for _ in range(1)]
    r = inner()
    return x, r
print(outer(), x)
try:
    class K:
        y = 1
        zs = [y for _ in range(2)]
    print(K.zs)
except NameError:
    print('NameError')`,
  },
  {
    id: 'h-py-format', lang: 'python',
    answer: "3.14| 42|42 | ab |1,234,567.9|0xff|1.23e-05|1|-0.0|111",
    code: `print(f"{3.14159:.2f}|{42:>5}|{42:<5}|{'ab':^6}|{1234567.891:,.1f}|{255:#x}|{0.000012345:.2e}|{True:d}|{-0.0}|{7:03b}")`,
  },
  {
    id: 'h-py-sorting', lang: 'python',
    answer: "[('c', 1), ('a', 1), ('b', 2), ('a', 2)] [('c', 1), ('a', 1), ('b', 2), ('a', 2)] ('b', 2) 3",
    code: `data = [('b', 2), ('a', 2), ('c', 1), ('a', 1)]
print(sorted(data, key=lambda t: t[1]))
print(sorted(data, key=lambda t: (-t[1], t[0]), reverse=True))
print(max(data, key=lambda t: t[1]), min([3, 1, 2], key=lambda v: -v))`,
  },
  {
    id: 'h-py-numbers', lang: 'python',
    answer: "False 2.67 5 2.5 2.0 0.5 False True False False",
    code: `print(0.1 + 0.2 == 0.3, round(2.675, 2), int('0b101', 0), 10 / 4, 10 // 4.0, 2 ** -1, (-8) ** (1/3) == -2,
      1e16 + 1 == 1e16, float('nan') == float('nan'), [float('nan')] == [float('nan')])`,
  },
  {
    id: 'h-py-default-cache', lang: 'python',
    answer: "4 9 hit 2 {2: 4, 3: 9}",
    code: `def f(n, cache={}):
    if n in cache:
        return f'hit {n}'
    cache[n] = n * n
    return cache[n]

print(f(2), f(3), f(2), f.__defaults__[0])`,
  },
  {
    id: 'h-py-exceptions', lang: 'python',
    answer: "finally ('ValueError', True, 'None') NameError",
    code: `def f():
    try:
        raise ValueError('a')
    except ValueError:
        try:
            raise KeyError('b') from None
        except KeyError as k:
            return type(k.__context__).__name__, k.__suppress_context__, repr(k.__cause__)
    finally:
        print('finally', end=' ')

print(f())
try:
    e = 1
    try:
        raise Exception
    except Exception as e:
        pass
    print(e)
except NameError:
    print('NameError')`,
  },
  {
    id: 'h-py-dunder', lang: 'python',
    answer: "V3 V102 V102 False x 99",
    code: `class V:
    def __init__(self, n): self.n = n
    def __add__(self, o): return V(self.n + (o.n if isinstance(o, V) else o))
    def __radd__(self, o): return V(self.n * 100 + o)
    def __bool__(self): return self.n > 0
    def __len__(self): return 99
    def __repr__(self): return f'V{self.n}'

print(V(1) + 2, 2 + V(1), sum([V(1), V(2)]), bool(V(0)), V(0) or 'x', len(V(5)))`,
  },
  {
    id: 'h-py-walrus', lang: 'python',
    answer: "[10, 16] 2 [5, 8, 16, 17] 17 {0: 0, 1: 'one', 2: 4} [0, 1, 2, 'a', 'b']",
    code: `data = [5, 3, 8, 1]
print([y for x in data if (y := x * 2) > 6], y)
total = 0
print([total := total + x for x in data], total)
print({x: x * x for x in range(3)} | {1: 'one'}, [*range(3), *'ab'])`,
  },
  {
    id: 'h-sql-group-null', lang: 'python',
    answer: "[(None, 2, 2, 5, 2.5), ('a', 2, 1, 1, 1.0), ('b', 1, 0, None, None)] 2 2",
    code: `import sqlite3
db = sqlite3.connect(':memory:')
db.executescript("CREATE TABLE t(g, v); INSERT INTO t VALUES ('a', 1), ('a', NULL), (NULL, 2), (NULL, 3), ('b', NULL);")
print(db.execute("SELECT g, COUNT(*), COUNT(v), SUM(v), AVG(v) FROM t GROUP BY g ORDER BY g").fetchall())
print(db.execute("SELECT COUNT(*) FROM t WHERE v <> 1").fetchone()[0], db.execute("SELECT COUNT(DISTINCT g) FROM t").fetchone()[0])`,
  },
  {
    id: 'h-sql-join-filter', lang: 'python',
    answer: "1 3 (2, 2.5, 1, 0, None)",
    code: `import sqlite3
db = sqlite3.connect(':memory:')
db.executescript("CREATE TABLE a(id, x); CREATE TABLE b(id, y); INSERT INTO a VALUES (1,'p'),(2,'q'),(3,'r'); INSERT INTO b VALUES (1,'s'),(1,'t'),(4,'u');")
print(db.execute("SELECT COUNT(*) FROM a LEFT JOIN b ON a.id = b.id WHERE b.y <> 't'").fetchone()[0],
      db.execute("SELECT COUNT(*) FROM a LEFT JOIN b ON a.id = b.id AND b.y <> 't'").fetchone()[0],
      db.execute("SELECT 5 / 2, 5 / 2.0, '10' < '9', 10 < 9, 'a' || NULL").fetchone())`,
  },
];

// The canary set (run.mjs --set canary), for a quick check before a release: the question a model alone got wrong in
// the last full run (h-py-dunder), the slowest to agree (h-js-loop-mix), and the others JavaScript, Python and SQL.
export const CANARY = ['h-py-dunder', 'h-js-loop-mix', 'h-js-async-errors', 'h-py-exceptions', 'h-js-tdz-hoisting', 'h-sql-group-null'];
