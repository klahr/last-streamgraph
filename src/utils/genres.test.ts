import { describe, it, expect } from 'vitest';
import { pickGenre, UNKNOWN_GENRE } from './genres';

describe('pickGenre', () => {
  it('takes the top tag, title-cased', () => {
    expect(pickGenre(['black metal', 'metal'])).toBe('Black Metal');
  });

  it('skips non-genre noise to the first real genre', () => {
    expect(pickGenre(['seen live', 'favorites', 'soundtrack'])).toBe('Soundtrack');
  });

  it('skips nationality and decade tags', () => {
    expect(pickGenre(['swedish', '80s', 'melodic death metal'])).toBe(
      'Melodic Death Metal',
    );
    expect(pickGenre(['1990s', 'pop'])).toBe('Pop');
  });

  it('returns Unknown when nothing usable remains', () => {
    expect(pickGenre(['seen live', 'favourites'])).toBe(UNKNOWN_GENRE);
    expect(pickGenre([])).toBe(UNKNOWN_GENRE);
  });
});
