/// Build-time configuration, supplied with `--dart-define`.
///
/// `SUPABASE_URL` and `SUPABASE_ANON_KEY` have no defaults on purpose: a build
/// without them can browse events but tells the user that sign-in is not
/// configured.
class AppConfig {
  static const String defaultApiBaseUrl =
      'https://chess-manager.alokas.com/api';

  final String apiBaseUrl;
  final String supabaseUrl;
  final String supabaseAnonKey;

  const AppConfig({
    this.apiBaseUrl = defaultApiBaseUrl,
    this.supabaseUrl = '',
    this.supabaseAnonKey = '',
  });

  factory AppConfig.fromEnvironment() {
    return const AppConfig(
      apiBaseUrl: String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: defaultApiBaseUrl,
      ),
      supabaseUrl: String.fromEnvironment('SUPABASE_URL'),
      supabaseAnonKey: String.fromEnvironment('SUPABASE_ANON_KEY'),
    );
  }

  bool get isAuthConfigured =>
      supabaseUrl.trim().isNotEmpty && supabaseAnonKey.trim().isNotEmpty;
}
