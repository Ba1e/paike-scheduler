FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5100
CMD ["sh", "-c", "exec gunicorn -w ${GUNICORN_WORKERS:-2} --threads ${GUNICORN_THREADS:-4} -b 0.0.0.0:5100 --timeout ${GUNICORN_TIMEOUT:-120} app:app"]
