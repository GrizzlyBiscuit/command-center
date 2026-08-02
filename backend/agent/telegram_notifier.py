class TelegramNotifier:
    def __init__(self, bot_token, chat_id):
        self.bot_token = bot_token
        self.chat_id = chat_id

    def send(self, text):
        # Placeholder notifier for local testing: no external calls.
        return {'ok': True, 'text': text}
