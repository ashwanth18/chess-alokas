import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/alokas_api.dart';
import '../services/email_app.dart';
import '../theme/alokas_theme.dart';
import '../widgets/account_scope.dart';
import '../widgets/legal.dart';
import '../widgets/message_card.dart';

/// Every call the sign-in pages make, so tests can swap them.
class AuthActions {
  final bool isConfigured;
  final Future<ApiResult<AuthSession>> Function(String email, String password)
  signIn;
  final Future<ApiResult<SignUpOutcome>> Function(String email, String password)
  signUp;
  final Future<ApiResult<void>> Function(String email) resendConfirmation;
  final Future<ApiResult<void>> Function(String email) requestPasswordReset;

  /// Null where the app cannot open an email app.
  final EmailAppOpener? openEmailApp;

  const AuthActions({
    required this.isConfigured,
    required this.signIn,
    required this.signUp,
    required this.resendConfirmation,
    required this.requestPasswordReset,
    this.openEmailApp,
  });
}

/// The brand backdrop shared by the launch and welcome screens.
class _BrandBackdrop extends StatelessWidget {
  final Widget child;

  const _BrandBackdrop({required this.child});

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [p.paper3, p.paper],
          stops: const [0, 0.65],
        ),
      ),
      child: child,
    );
  }
}

/// Shown for the moment it takes to read what this phone remembers, so the
/// welcome screen never flashes up for someone already signed in.
class LaunchScreen extends StatelessWidget {
  const LaunchScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      key: Key('launch-screen'),
      body: _BrandBackdrop(child: Center(child: BrandMark(size: 88))),
    );
  }
}

/// First launch, and after signing out: the mark, one line, three ways in.
class WelcomeScreen extends StatelessWidget {
  final VoidCallback onSignIn;
  final VoidCallback onCreateAccount;
  final VoidCallback onBrowse;

  const WelcomeScreen({
    super.key,
    required this.onSignIn,
    required this.onCreateAccount,
    required this.onBrowse,
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return Scaffold(
      key: const Key('welcome-screen'),
      body: _BrandBackdrop(
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) => SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: IntrinsicHeight(
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 440),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Spacer(flex: 3),
                          const SizedBox(height: 32),
                          const Center(child: BrandMark(size: 96)),
                          const SizedBox(height: 28),
                          Text(
                            'Chess Alokas',
                            textAlign: TextAlign.center,
                            style: atype(
                              36,
                              weight: 800,
                              width: 108,
                              color: p.ink,
                              height: 1.1,
                            ),
                          ),
                          const SizedBox(height: 10),
                          Text(
                            'Your chess life, in one app.',
                            textAlign: TextAlign.center,
                            style: atype(18, color: p.ink2, height: 1.35),
                          ),
                          const Spacer(flex: 4),
                          const SizedBox(height: 40),
                          ElevatedButton(
                            key: const Key('welcome-sign-in'),
                            style: ElevatedButton.styleFrom(
                              minimumSize: const Size.fromHeight(56),
                            ),
                            onPressed: onSignIn,
                            child: const Text('Sign in'),
                          ),
                          const SizedBox(height: 12),
                          OutlinedButton(
                            key: const Key('welcome-create-account'),
                            style: OutlinedButton.styleFrom(
                              minimumSize: const Size.fromHeight(56),
                              textStyle: atype(16, weight: 700),
                            ),
                            onPressed: onCreateAccount,
                            child: const Text('Create account'),
                          ),
                          const SizedBox(height: 20),
                          Center(
                            child: TextButton(
                              key: const Key('welcome-browse'),
                              style: TextButton.styleFrom(
                                foregroundColor: p.ink2,
                                textStyle: atype(14, weight: 500),
                              ),
                              onPressed: onBrowse,
                              child: const Text(
                                'Browse tournaments without an account',
                                textAlign: TextAlign.center,
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

enum _Mode { signIn, signUp, reset, resetSent, checkEmail }

/// Full-screen sign-in and account creation, with the password reset and the
/// confirmation email in between. Pops with true once someone is signed in.
class AuthPage extends StatefulWidget {
  final AuthActions actions;
  final AuthStart start;
  final String? initialEmail;

  const AuthPage({
    super.key,
    required this.actions,
    this.start = AuthStart.signIn,
    this.initialEmail,
  });

  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  static const int minPasswordLength = 8;

  late final TextEditingController _email = TextEditingController(
    text: widget.initialEmail ?? '',
  );
  final TextEditingController _password = TextEditingController();
  final FocusNode _passwordFocus = FocusNode();
  late _Mode _mode = widget.start == AuthStart.createAccount
      ? _Mode.signUp
      : _Mode.signIn;
  bool _busy = false;
  bool _showPassword = false;
  String? _emailError;
  String? _passwordError;
  String? _error;
  String? _notice;

  /// Set when the server's error can be fixed with one tap.
  _Fix? _fix;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  void _switchTo(_Mode mode, {bool keepPassword = false}) {
    setState(() {
      _mode = mode;
      _busy = false;
      _showPassword = false;
      _emailError = null;
      _passwordError = null;
      _error = null;
      _notice = null;
      _fix = null;
      if (!keepPassword) _password.clear();
    });
  }

  String get _address => _email.text.trim();

  bool _looksLikeEmail(String value) =>
      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value.trim());

  void _clearMessages() {
    _error = null;
    _notice = null;
    _fix = null;
  }

  /// Field problems found on the phone, before anything is sent.
  bool _checkFields({required bool newPassword, bool needPassword = true}) {
    String? emailError;
    String? passwordError;
    if (_address.isEmpty) {
      emailError = 'Enter your email.';
    } else if (!_looksLikeEmail(_address)) {
      emailError = 'Enter a valid email address.';
    }
    if (needPassword) {
      if (_password.text.isEmpty) {
        passwordError = newPassword
            ? 'Choose a password.'
            : 'Enter your password.';
      } else if (newPassword && _password.text.length < minPasswordLength) {
        passwordError = 'Use at least $minPasswordLength characters.';
      }
    }
    setState(() {
      _emailError = emailError;
      _passwordError = passwordError;
      _clearMessages();
    });
    return emailError == null && passwordError == null;
  }

  void _signedIn() {
    TextInput.finishAutofillContext();
    Navigator.of(context).pop(true);
  }

  Future<void> _submitSignIn() async {
    if (_busy || !_checkFields(newPassword: false)) return;
    setState(() => _busy = true);
    final result = await widget.actions.signIn(_address, _password.text);
    if (!mounted) return;
    switch (result) {
      case ApiSuccess():
        _signedIn();
      case ApiFailure(:final message):
        setState(() {
          _busy = false;
          _error = message;
          _fix = message == emailNotConfirmedMessage ? _Fix.resend : null;
        });
    }
  }

  Future<void> _submitSignUp() async {
    if (_busy || !_checkFields(newPassword: true)) return;
    setState(() => _busy = true);
    final result = await widget.actions.signUp(_address, _password.text);
    if (!mounted) return;
    switch (result) {
      case ApiSuccess(value: SignedUpWithSession()):
        _signedIn();
      case ApiSuccess(value: ConfirmationRequired()):
        TextInput.finishAutofillContext();
        _switchTo(_Mode.checkEmail);
      case ApiFailure(:final message):
        setState(() {
          _busy = false;
          _error = message;
          _fix = message == accountExistsMessage ? _Fix.signInInstead : null;
        });
    }
  }

  Future<void> _submitReset() async {
    if (_busy || !_checkFields(newPassword: false, needPassword: false)) {
      return;
    }
    setState(() => _busy = true);
    final result = await widget.actions.requestPasswordReset(_address);
    if (!mounted) return;
    switch (result) {
      case ApiSuccess():
        _switchTo(_Mode.resetSent);
      case ApiFailure(:final message):
        setState(() {
          _busy = false;
          _error = message;
        });
    }
  }

  Future<void> _resend() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _clearMessages();
    });
    final result = await widget.actions.resendConfirmation(_address);
    if (!mounted) return;
    setState(() {
      _busy = false;
      switch (result) {
        case ApiSuccess():
          _notice = 'Sent again to $_address.';
        case ApiFailure(:final message):
          _error = message;
      }
    });
  }

  Future<void> _openEmail() async {
    final open = widget.actions.openEmailApp;
    final opened = open != null && await open();
    if (!opened && mounted) {
      setState(() {
        _clearMessages();
        _error =
            'No email app found on this phone. Open your email to find '
            'the link.';
      });
    }
  }

  /// Back from a step inside the page returns to the step before; from the
  /// first step it leaves.
  _Mode? get _backTo => switch (_mode) {
    _Mode.signIn || _Mode.signUp => null,
    _Mode.reset || _Mode.resetSent || _Mode.checkEmail => _Mode.signIn,
  };

  @override
  Widget build(BuildContext context) {
    final back = _backTo;
    return PopScope(
      canPop: back == null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && back != null) _switchTo(back, keepPassword: false);
      },
      child: Scaffold(
        appBar: AppBar(leading: const BackButton(key: Key('auth-back'))),
        body: SafeArea(
          top: false,
          child: SingleChildScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: widget.actions.isConfigured
                    ? AutofillGroup(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: _body(),
                        ),
                      )
                    : _notConfigured(),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _notConfigured() {
    final p = context.pal;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _heading('Sign in', null),
        Text(
          notConfiguredMessage,
          key: const Key('sign-in-not-configured'),
          style: atype(16, weight: 600, color: p.wait, height: 1.35),
        ),
      ],
    );
  }

  List<Widget> _body() => switch (_mode) {
    _Mode.signIn => _signInBody(),
    _Mode.signUp => _signUpBody(),
    _Mode.reset => _resetBody(),
    _Mode.resetSent => _resetSentBody(),
    _Mode.checkEmail => _checkEmailBody(),
  };

  Widget _heading(String title, String? line) {
    final p = context.pal;
    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            key: const Key('auth-title'),
            style: atype(
              30,
              weight: 800,
              width: 106,
              color: p.ink,
              height: 1.15,
            ),
          ),
          if (line != null) ...[
            const SizedBox(height: 8),
            Text(line, style: atype(16, color: p.ink2, height: 1.4)),
          ],
        ],
      ),
    );
  }

  Widget _emailField({required bool last, VoidCallback? onDone}) => TextField(
    key: const Key('sign-in-email'),
    controller: _email,
    keyboardType: TextInputType.emailAddress,
    textInputAction: last ? TextInputAction.done : TextInputAction.next,
    autocorrect: false,
    autofillHints: const [AutofillHints.email],
    onChanged: (_) {
      if (_emailError != null || _error != null) {
        setState(() {
          _emailError = null;
          _clearMessages();
        });
      }
    },
    onSubmitted: (_) => last ? onDone?.call() : _passwordFocus.requestFocus(),
    decoration: InputDecoration(
      labelText: 'Email',
      prefixIcon: const Icon(Icons.mail_outline),
      errorText: _emailError,
      errorMaxLines: 3,
    ),
  );

  Widget _passwordField({required bool isNew, required VoidCallback onDone}) {
    return TextField(
      key: const Key('sign-in-password'),
      controller: _password,
      focusNode: _passwordFocus,
      obscureText: !_showPassword,
      autocorrect: false,
      enableSuggestions: false,
      textInputAction: TextInputAction.done,
      autofillHints: [
        isNew ? AutofillHints.newPassword : AutofillHints.password,
      ],
      onChanged: (_) {
        if (_passwordError != null || _error != null) {
          setState(() {
            _passwordError = null;
            _clearMessages();
          });
        }
      },
      onSubmitted: (_) => onDone(),
      decoration: InputDecoration(
        labelText: 'Password',
        prefixIcon: const Icon(Icons.lock_outline),
        helperText: isNew ? 'At least $minPasswordLength characters' : null,
        errorText: _passwordError,
        errorMaxLines: 3,
        suffixIcon: IconButton(
          key: const Key('toggle-password'),
          tooltip: _showPassword ? 'Hide password' : 'Show password',
          onPressed: () => setState(() => _showPassword = !_showPassword),
          icon: Icon(
            _showPassword
                ? Icons.visibility_off_outlined
                : Icons.visibility_outlined,
          ),
        ),
      ),
    );
  }

  /// Keeps its colour while busy, so it reads as working rather than off.
  Widget _primary(Key key, String label, String busyLabel, VoidCallback onTap) {
    final p = context.pal;
    return Semantics(
      liveRegion: _busy,
      child: ElevatedButton(
        key: key,
        style: ElevatedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
        onPressed: _busy ? () {} : onTap,
        child: _busy
            ? Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      color: p.onAccent,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Flexible(child: Text(busyLabel)),
                ],
              )
            : Text(label),
      ),
    );
  }

  Widget _secondary(Key key, String label, VoidCallback? onTap) =>
      OutlinedButton(
        key: key,
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(56),
          textStyle: atype(16, weight: 700),
        ),
        onPressed: onTap,
        child: Text(label, textAlign: TextAlign.center),
      );

  /// The server's answer, in a box above the button, with its one-tap fix.
  List<Widget> _feedback() {
    final p = context.pal;
    final error = _error;
    final notice = _notice;
    return [
      if (error != null)
        Container(
          margin: const EdgeInsets.only(top: 16),
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          decoration: BoxDecoration(
            color: p.flagWash,
            borderRadius: BorderRadius.circular(AlokasTheme.radius),
            border: Border.all(color: p.flag),
          ),
          child: Semantics(
            liveRegion: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 1),
                      child: Icon(Icons.error_outline, color: p.flag, size: 20),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        error,
                        key: const Key('sign-in-error'),
                        style: atype(
                          15,
                          weight: 600,
                          color: p.flag,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
                if (_fix == _Fix.resend)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      key: const Key('resend-confirmation'),
                      style: TextButton.styleFrom(foregroundColor: p.flag),
                      onPressed: _busy ? null : _resend,
                      child: const Text('Resend confirmation email'),
                    ),
                  ),
                if (_fix == _Fix.signInInstead)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      key: const Key('use-sign-in'),
                      style: TextButton.styleFrom(foregroundColor: p.flag),
                      onPressed: () => _switchTo(_Mode.signIn),
                      child: const Text('Sign in instead'),
                    ),
                  ),
              ],
            ),
          ),
        ),
      if (notice != null)
        Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Semantics(
            liveRegion: true,
            child: Text(
              notice,
              key: const Key('sign-in-notice'),
              style: atype(15, weight: 600, color: p.go, height: 1.35),
            ),
          ),
        ),
    ];
  }

  Widget _switchRow(String question, Key key, String action, _Mode to) {
    final p = context.pal;
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(question, style: atype(15, color: p.ink2)),
          TextButton(
            key: key,
            onPressed: () => _switchTo(to),
            child: Text(action),
          ),
        ],
      ),
    );
  }

  List<Widget> _signInBody() => [
    _heading('Welcome back', 'Sign in to follow your games and players.'),
    _emailField(last: false),
    const SizedBox(height: 16),
    _passwordField(isNew: false, onDone: _submitSignIn),
    Align(
      alignment: Alignment.centerRight,
      child: TextButton(
        key: const Key('open-reset'),
        onPressed: () => _switchTo(_Mode.reset),
        child: const Text('Forgot password?'),
      ),
    ),
    ..._feedback(),
    const SizedBox(height: 16),
    _primary(
      const Key('sign-in-submit'),
      'Sign in',
      'Signing in',
      _submitSignIn,
    ),
    _switchRow(
      'New to Chess Alokas?',
      const Key('open-sign-up'),
      'Create account',
      _Mode.signUp,
    ),
  ];

  List<Widget> _signUpBody() {
    final p = context.pal;
    return [
      _heading(
        'Create your account',
        'Register players, follow your games and keep your certificates.',
      ),
      _emailField(last: false),
      const SizedBox(height: 16),
      _passwordField(isNew: true, onDone: _submitSignUp),
      ..._feedback(),
      const SizedBox(height: 20),
      Text(
        'By creating an account you agree to the Terms and Privacy Policy.',
        key: const Key('signup-agreement'),
        style: atype(14, color: p.ink2, height: 1.35),
      ),
      const Wrap(
        spacing: 4,
        children: [
          LegalLink('Terms', termsUrl),
          LegalLink('Privacy Policy', privacyUrl),
        ],
      ),
      const SizedBox(height: 8),
      _primary(
        const Key('sign-up-submit'),
        'Create account',
        'Creating account',
        _submitSignUp,
      ),
      _switchRow(
        'Have an account?',
        const Key('open-sign-in'),
        'Sign in',
        _Mode.signIn,
      ),
    ];
  }

  List<Widget> _resetBody() => [
    _heading(
      'Reset your password',
      "Enter your email and we'll send you a link to choose a new one.",
    ),
    _emailField(last: true, onDone: _submitReset),
    ..._feedback(),
    const SizedBox(height: 24),
    _primary(const Key('reset-submit'), 'Send link', 'Sending', _submitReset),
  ];

  Widget _mailIcon() {
    final p = context.pal;
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 20),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(
            color: p.accentWash,
            shape: BoxShape.circle,
          ),
          child: Icon(
            Icons.mark_email_unread_outlined,
            color: p.accent,
            size: 34,
          ),
        ),
      ),
    );
  }

  List<Widget> _resetSentBody() {
    final p = context.pal;
    return [
      _mailIcon(),
      _heading('Check your email', null),
      Text(
        'If there is an account for $_address, a link to reset your password '
        'is on its way. Choose a new password, then sign in here.',
        key: const Key('reset-sent-message'),
        style: atype(16, color: p.ink, height: 1.4),
      ),
      const SizedBox(height: 28),
      _primary(
        const Key('back-to-sign-in'),
        'Back to sign in',
        'Please wait',
        () => _switchTo(_Mode.signIn),
      ),
    ];
  }

  List<Widget> _checkEmailBody() {
    final p = context.pal;
    final canOpen = widget.actions.openEmailApp != null;
    void signIn() => _switchTo(_Mode.signIn);
    return [
      _mailIcon(),
      _heading('Check your email', null),
      Text(
        'We sent a confirmation link to',
        style: atype(16, color: p.ink2, height: 1.4),
      ),
      const SizedBox(height: 2),
      Text(
        _address,
        key: const Key('check-email-address'),
        style: atype(18, weight: 700, color: p.ink, height: 1.3),
      ),
      const SizedBox(height: 12),
      Text(
        'Open the link to confirm your account, then come back and sign in.',
        key: const Key('check-email-message'),
        style: atype(16, color: p.ink2, height: 1.4),
      ),
      ..._feedback(),
      const SizedBox(height: 28),
      if (canOpen) ...[
        _primary(
          const Key('open-email-app'),
          'Open email app',
          'Please wait',
          _openEmail,
        ),
        const SizedBox(height: 12),
        _secondary(
          const Key('confirmed-sign-in'),
          "I've confirmed, sign in",
          signIn,
        ),
      ] else
        _primary(
          const Key('confirmed-sign-in'),
          "I've confirmed, sign in",
          'Please wait',
          signIn,
        ),
      const SizedBox(height: 12),
      Wrap(
        alignment: WrapAlignment.center,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text('No email?', style: atype(15, color: p.ink2)),
          TextButton(
            key: const Key('resend-confirmation'),
            onPressed: _busy ? null : _resend,
            child: const Text('Resend email'),
          ),
        ],
      ),
    ];
  }
}

enum _Fix { resend, signInInstead }
