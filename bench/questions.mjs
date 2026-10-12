// Benchmark questions: short programs with a well-known trap. Each answer is what the program prints, with its
// lines joined by single spaces; `node bench/run.mjs --verify` runs every program and checks the answer key.
export const QUESTIONS = [
  { id: 'js-sort', lang: 'js', code: `console.log([10, 9, 1, 2].sort().join(','));`, answer: '1,10,2,9' },
  { id: 'js-parseint', lang: 'js', code: `console.log(['1', '7', '11'].map(parseInt).join(','));`, answer: '1,NaN,3' },
  {
    id: 'js-event-loop', lang: 'js',
    code: `console.log('A');
setTimeout(() => console.log('B'), 0);
Promise.resolve().then(() => console.log('C'));
queueMicrotask(() => console.log('D'));
process.nextTick(() => console.log('E'));
console.log('F');`,
    answer: 'A F E C D B',
  },
  { id: 'js-coercion', lang: 'js', code: `console.log(typeof null, typeof NaN, [] + {}, [] == ![]);`, answer: 'object number [object Object] true' },
  { id: 'js-array-length', lang: 'js', code: `const a = [1, 2, 3];
a.length = 1;
a[3] = 4;
console.log(a.length, a.join('-'));`, answer: '4 1---4' },
  { id: 'js-var-closure', lang: 'js', code: `for (var i = 0; i < 3; i++) setTimeout(() => process.stdout.write(String(i)), 0);
setTimeout(() => console.log(''), 1);`, answer: '333' },
  { id: 'js-date-overflow', lang: 'js', code: `console.log(new Date(2024, 1, 30).getMonth(), new Date(2023, 1, 29).getDate());`, answer: '2 1' },
  { id: 'js-rounding', lang: 'js', code: `console.log((1.005).toFixed(2), Math.round(-2.5), Math.round(2.5), (0.1 + 0.2).toFixed(17));`, answer: '1.00 -2 3 0.30000000000000004' },
  { id: 'js-banana', lang: 'js', code: `console.log('b' + 'a' + +'a' + 'a');`, answer: 'baNaNa' },
  {
    id: 'js-generator', lang: 'js',
    code: `function* g() {
  const x = yield 1;
  console.log('x=' + x);
  yield x * 2;
}
const it = g();
console.log(it.next(5).value, it.next(7).value);`,
    answer: 'x=7 1 14',
  },
  {
    id: 'js-async-order', lang: 'js',
    code: `async function f() {
  console.log(1);
  await null;
  console.log(2);
}
f();
Promise.resolve().then(() => console.log(3));
console.log(4);`,
    answer: '1 4 2 3',
  },
  {
    id: 'js-this', lang: 'js',
    code: `const o = {
  name: 'o',
  regular() { return [1].map(function () { return this === undefined ? 'undefined' : 'global'; })[0]; },
  arrow() { return [1].map(() => this.name)[0]; },
};
console.log(o.regular(), o.arrow());`,
    answer: 'global o',
  },
  {
    id: 'py-mutable-default', lang: 'python',
    code: `def f(x, acc=[]):
    acc.append(x)
    return acc

f(1)
print(f(2), f(3))`,
    answer: '[1, 2, 3] [1, 2, 3]',
  },
  { id: 'py-late-binding', lang: 'python', code: `fs = [lambda: i for i in range(3)]
print([f() for f in fs])`, answer: '[2, 2, 2]' },
  { id: 'py-floor-division', lang: 'python', code: `print(-7 // 2, -7 % 2, int(-7 / 2), divmod(7, -2))`, answer: '-4 1 -3 (-4, -1)' },
  { id: 'py-banker-rounding', lang: 'python', code: `print(round(2.5), round(3.5), round(0.125, 2), round(-0.5))`, answer: '2 4 0.12 0' },
  { id: 'py-shared-rows', lang: 'python', code: `a = [[0] * 2] * 2
a[0][0] = 1
print(a)`, answer: '[[1, 0], [1, 0]]' },
  { id: 'py-chained-comparison', lang: 'python', code: `print(1 < 2 < 3, 3 > 2 > 1 == True, (3 > 2) > 1, 1 == 1.0 is True)`, answer: 'True True False False' },
  {
    id: 'py-finally-return', lang: 'python',
    code: `def f():
    try:
        return 'try'
    finally:
        return 'finally'

def g():
    for i in range(3):
        try:
            continue
        finally:
            print(i, end=' ')
    return 'done'

print(f(), g())`,
    answer: '0 1 2 finally done',
  },
  {
    id: 'py-unbound-local', lang: 'python',
    code: `x = 10
def g():
    print(x)
    x = 5
try:
    g()
except Exception as e:
    print(type(e).__name__)`,
    answer: 'UnboundLocalError',
  },
  { id: 'py-sorted-case', lang: 'python', code: `print(sorted(['b', 'B', 'a', 'A', '_', '1']))`, answer: "['1', 'A', 'B', '_', 'a', 'b']" },
  {
    id: 'py-generator-exhausted', lang: 'python',
    code: `squares = (n * n for n in range(4))
print(sum(squares), sum(squares), 9 in squares)`,
    answer: '14 0 False',
  },
  {
    id: 'sql-null', lang: 'python',
    code: `import sqlite3
db = sqlite3.connect(':memory:')
print(db.execute("SELECT NULL = NULL, NULL IS NULL, COUNT(x), COUNT(*), SUM(x) FROM (SELECT NULL AS x UNION ALL SELECT 1 UNION ALL SELECT NULL)").fetchone())`,
    answer: '(None, 1, 1, 3, 1)',
  },
  {
    id: 'sql-not-in-null', lang: 'python',
    code: `import sqlite3
db = sqlite3.connect(':memory:')
print(db.execute("SELECT COUNT(*) FROM (SELECT 1 AS v UNION ALL SELECT 2) WHERE v NOT IN (SELECT 2 UNION ALL SELECT NULL)").fetchone()[0])`,
    answer: '0',
  },
];
