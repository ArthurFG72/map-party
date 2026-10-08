import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantReplyForIntent, parseAssistantIntent } from '../src/assistantIntent.js';

test('entende busca conversacional e escolha por número', () => {
  const intent = parseAssistantIntent('Me leve para um hotel', {});
  assert.deepEqual(intent, { type: 'search_place', query: 'um hotel' });
  const choice = parseAssistantIntent('o segundo', { options: [{ name: 'A' }, { name: 'B' }] });
  assert.equal(choice.type, 'choose_place');
  assert.equal(choice.index, 1);
  assert.equal(assistantReplyForIntent(choice), 'Você escolheu B.');
});

test('normaliza busca falada por posto perto do usuario', () => {
  assert.deepEqual(parseAssistantIntent('Ache um posto perto de mim'), {
    type: 'search_place',
    query: 'um posto'
  });
});

test('entende pedido natural de parada para dormir', () => {
  assert.deepEqual(parseAssistantIntent('Preciso parar para dormir em Uberlandia', {}), {
    type: 'search_place',
    query: 'hotel em uberlandia'
  });
});

test('entende busca de estabelecimento com nome e qualificadores', () => {
  assert.deepEqual(parseAssistantIntent('Procure SESI Vila Canaã'), {
    type: 'search_place',
    query: 'sesi vila canaa'
  });
});

test('entende comandos de navegação', () => {
  assert.equal(parseAssistantIntent('pare a navegação').type, 'navigation.cancel');
  assert.equal(parseAssistantIntent('quanto falta?').type, 'navigation.get_status');
  assert.equal(parseAssistantIntent('pode iniciar').type, 'navigation.start');
  assert.equal(parseAssistantIntent('voltar para a navegação').type, 'navigation.resume');
});
