import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMyEmbedMovieUrl, buildMyEmbedSeriesUrl } from '../lib/myembed.js';

test('MyEmbed movie URLs use the TMDb movie identifier', () => {
  assert.equal(buildMyEmbedMovieUrl('969681'), 'https://myembed.biz/filme/969681');
});

test('MyEmbed movie URLs reject invalid identifiers', () => {
  for (const id of ['0', '-1', '1.5', 'tt22084616', '12345678901']) {
    assert.throws(() => buildMyEmbedMovieUrl(id), /ID TMDb inválido/);
  }
});

test('MyEmbed series URLs support full episode lists and direct episodes', () => {
  assert.equal(buildMyEmbedSeriesUrl('30984'), 'https://myembed.biz/serie/30984');
  assert.equal(buildMyEmbedSeriesUrl('30984', '1', '1'), 'https://myembed.biz/serie/30984/1/1');
});

test('MyEmbed series URLs reject invalid IDs and incomplete episode selections', () => {
  assert.throws(() => buildMyEmbedSeriesUrl('0'), /ID TMDb inválido/);
  assert.throws(() => buildMyEmbedSeriesUrl('30984', '1'), /Temporada ou episódio inválidos/);
  assert.throws(() => buildMyEmbedSeriesUrl('30984', '1', '0'), /Temporada ou episódio inválidos/);
});
