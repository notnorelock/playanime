/**
 * The frontend's only route to the backend.
 *
 * Components and stores import from here; nothing in the application issues a
 * `fetch` of its own. That is what keeps the base URL, the credential mode, the
 * CSRF header and the error model in exactly one place.
 */
export { http, onUnauthorized } from './client';
export { ApiError, NetworkError, AbortError } from './errors';

export { adminApi } from './admin';
export { animeApi } from './anime';
export { blogApi } from './blog';
export { authApi } from './auth';
export { catalogueApi, type EditableEpisode } from './catalogue';
export { contactApi } from './contact';
export { devicesApi } from './devices';
export { discoveryApi } from './discovery';
export { engagementApi } from './engagement';
export { episodesApi } from './episodes';
export { libraryApi } from './library';
export { notificationsApi } from './notifications';
export { profilesApi } from './profiles';
export { reportsApi } from './reports';
export { translatorsApi, type MyTranslatorGroup } from './translators';
