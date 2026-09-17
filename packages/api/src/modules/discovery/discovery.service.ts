import type { CalendarQuery } from '@playanime/contracts';
import { AnimeRepository, db } from '@playanime/database';
import { ValidationError } from '@playanime/shared';
import { toCalendarEntry } from './discovery.mapper.js';

const repository = new AnimeRepository(db());

export function listGenres(includeMature: boolean) {
  return repository.listGenres(includeMature);
}

export function listTags(includeAdult: boolean) {
  return repository.listTags(includeAdult);
}

export async function getCalendar(query: CalendarQuery, includeAdult: boolean) {
  const from = new Date(`${query.from}T00:00:00.000Z`);
  const to = new Date(`${query.to}T00:00:00.000Z`);
  if (to < from || to.getTime() - from.getTime() > 31 * 86_400_000) {
    throw new ValidationError('Zakres kalendarza musi obejmować najwyżej 31 dni.');
  }
  const rows = await repository.calendar(query.from, query.to, includeAdult);
  return {
    from: query.from,
    to: query.to,
    entries: rows.map((row) => toCalendarEntry(row, query.from)),
  };
}
