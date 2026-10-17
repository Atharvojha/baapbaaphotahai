import os

from dotenv import load_dotenv
from sarvamai import SarvamAI

load_dotenv()

client = SarvamAI(api_subscription_key=os.environ["SARVAM_API_KEY"])

response = client.chat.completions(
    model="sarvam-105b-conversations",
    messages=[{"role": "user", "content": "Ek line mein bolo: subah jaldi uthna kyun zaroori hai?"}],
)
print(response.choices[0].message.content)
