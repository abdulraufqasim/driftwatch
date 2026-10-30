const assert = require('node:assert/strict');
const { test } = require('node:test');
const { escapeCsvValue, rowsToCsv } = require('../csv');

test('escapes CSV delimiters, quotes, and embedded newlines', () => {
  assert.equal(escapeCsvValue('one,two'), '"one,two"');
  assert.equal(escapeCsvValue('say "hello"'), '"say ""hello"""');
  assert.equal(escapeCsvValue('first\nsecond'), '"first\nsecond"');
});

test('prefixes spreadsheet formula values before CSV quoting', () => {
  for (const value of ['=1+1', '+SUM(A1:A2)', '-10', '@formula', ' \t=1+1']) {
    assert.equal(escapeCsvValue(value), `"\'${value}"`);
  }
});

test('renders rows with CRLF separators', () => {
  assert.equal(rowsToCsv([['a', 'b'], ['1', '2']]), '"a","b"\r\n"1","2"');
});
