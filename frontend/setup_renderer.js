const continueButton = document.getElementById('continueButton');
const message = document.getElementById('setupMessage');

function setMessage(text = '', ok = false) {
  message.textContent = text;
  message.classList.toggle('ok', ok);
}

continueButton.addEventListener('click', async () => {
  continueButton.disabled = true;
  setMessage('');

  try {
    const result = await window.setupAPI.complete();

    if (!result.ok) {
      setMessage(result.error || 'Unable to complete device setup.');
      continueButton.disabled = false;
      return;
    }

    setMessage('Device setup complete. Opening owner identity enrollment.', true);
  } catch (error) {
    console.error(error);
    setMessage('Unable to complete device setup.');
    continueButton.disabled = false;
  }
});
