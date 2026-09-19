const loginView = document.getElementById('loginView');
const registerView = document.getElementById('registerView');
const message = document.getElementById('authMessage');
const hint = document.getElementById('authHint');

function setMessage(text = '', ok = false) {
  message.textContent = text;
  message.classList.toggle('ok', ok);
}

function setBusy(busy) {
  document.querySelectorAll('input, button').forEach((element) => {
    element.disabled = busy;
  });
}

function show(view) {
  const registering = view === 'register';
  loginView.hidden = registering;
  registerView.hidden = !registering;
  setMessage('');
  hint.textContent = registering
    ? 'Create a local account. Your password is stored as a secure hash.'
    : 'Sign in to start privacy protection.';
}

document.getElementById('showRegister').addEventListener('click', () => show('register'));
document.getElementById('showLogin').addEventListener('click', () => show('login'));

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');
  setBusy(true);

  try {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const result = await window.authAPI.login(username, password);

    if (!result.ok) {
      setMessage(result.error);
      return;
    }

    setMessage('Signed in. Starting SmartScreen…', true);
  } catch (error) {
    setMessage('Unable to sign in right now.');
  } finally {
    setBusy(false);
  }
});

document.getElementById('registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');

  const username = document.getElementById('registerUsername').value;
  const password = document.getElementById('registerPassword').value;
  const confirm = document.getElementById('registerConfirm').value;

  if (password !== confirm) {
    setMessage('Passwords do not match.');
    return;
  }

  setBusy(true);

  try {
    const result = await window.authAPI.register(username, password);

    if (!result.ok) {
      setMessage(result.error);
      return;
    }

    setMessage('Account created. Starting SmartScreen…', true);
  } catch (error) {
    setMessage('Unable to create the account right now.');
  } finally {
    setBusy(false);
  }
});

(async function initialize() {
  try {
    const status = await window.authAPI.status();
    if (!status.registered) {
      show('register');
    } else {
      show('login');
    }
  } catch (error) {
    show('login');
  }
})();
