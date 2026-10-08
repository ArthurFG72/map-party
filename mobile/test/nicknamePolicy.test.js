import test from 'node:test';
import assert from 'node:assert/strict';
import { isHairLossNickname } from '../src/nicknamePolicy.js';

test('bloqueia apelidos relacionados a falta de cabelo', () => {
  for (const name of ['Careca', 'CALVO', 'calvície', 'sem cabelo', 'carequinha', 'alopecia', 'cabeça lisa']) {
    assert.equal(isHairLossNickname(name), true, name);
  }
});

test('permite nomes sem relação com falta de cabelo', () => {
  for (const name of ['Ana', 'Carlos', 'Calvino', 'Cabeleireiro']) {
    assert.equal(isHairLossNickname(name), false, name);
  }
});