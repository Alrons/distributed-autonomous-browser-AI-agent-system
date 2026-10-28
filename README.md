# Distributed Autonomous Browser AI Agent System 🤖(MVP)

![Java](https://img.shields.io/badge/Java-17+-blue)
![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.x-brightgreen)
![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-yellow)
![n8n](https://img.shields.io/badge/n8n-Workflow-orange)
![LLM](https://img.shields.io/badge/AI-LM_Studio-purple)

Распределенная клиент-серверная система автономного управления веб-браузером с помощью локальной большой языковой модели (LLM). Система способна анализировать содержимое веб-страниц, принимать решения и выполнять рутинные задачи (например, отклики на вакансии на hh.ru, ведение диалогов, навигация) без участия человека.

## 🏗 Архитектура

Проект состоит из 4 независимых компонентов:
1. **Spring Boot (Сервер)** — центральный узел, хранящий текущее состояние страницы (`BrowserState`) и очередь команд. Отвечает за очистку сырого HTML-кода через библиотеку Jsoup.
2. **Chrome Extension (Клиент)** — расширение-исполнитель (Manifest V3). Собирает семантический слепок DOM-дерева, отправляет его на сервер и выполняет команды (клики, ввод текста, переходы) внутри активной вкладки.
3. **n8n (Оркестратор)** — интеллектуальное ядро системы (State Machine). Содержит workflow с алгоритмами маршрутизации, защитой от зацикливаний и разделением задач между тремя ИИ-ролями (Планировщик, Писатель, Решатель).
4. **LM Studio** — локальный сервер ИИ-модели (например, `qwen2.5-coder-14b-instruct`), предоставляющий OpenAI-совместимый API для n8n.

---

## 📋 Требования к окружению (Prerequisites)

Для локального запуска системы вам потребуется:
* **Java 17** или выше и **Maven**
* **Google Chrome**
* **Docker** (для запуска n8n)
* **LM Studio** (или любой другой провайдер, совместимый с OpenAI API)

---

## 🚀 Установка и запуск

Чтобы система заработала, необходимо последовательно запустить все 4 компонента.

### Шаг 1: Запуск ИИ (LM Studio)
1. Скачайте и установите [LM Studio](https://lmstudio.ai/).
2. Загрузите подходящую модель (рекомендуется `qwen2.5-coder-14b-instruct` или аналогичная).
3. Перейдите во вкладку **Local Server**, включите сервер (по умолчанию порт `1234`).
4. Убедитесь, что сервер доступен (CORS включен).

### Шаг 2: Запуск Spring Boot сервера
1. Склонируйте репозиторий:
   ```bash
   git clone https://github.com/Alrons/distributed-autonomous-browser-AI-agent-system.git
   cd distributed-autonomous-browser-AI-agent-system
   ```
2. Соберите и запустите проект через Maven:
   ```bash
   mvn clean install
   mvn spring-boot:run
   ```
3. Сервер запустится на порту `8080` (и/или `9090` в зависимости от ваших настроек `application.properties`).

### Шаг 3: Установка Chrome Extension
1. Откройте Google Chrome и перейдите по адресу `chrome://extensions/`.
2. Включите **Режим разработчика** (Developer mode) в правом верхнем углу.
3. Нажмите **Загрузить распакованное расширение** (Load unpacked).
4. Выберите папку с исходным кодом расширения (где лежат `manifest.json`, `popup.html`, `background.js`).
5. Закрепите расширение "AI Agent Hands" на панели задач браузера.

### Шаг 4: Запуск и настройка n8n
Рекомендуется запускать n8n через Docker, чтобы он имел доступ к локальному Spring Boot серверу и LM Studio через `host.docker.internal`.

1. Запустите контейнер n8n:
   ```bash
   docker run -it --rm \
     --name n8n \
     -p 5678:5678 \
     -e N8N_ENFORCEMENT_REQUEST_REQUIRE_AUTHENTICATION=false \
     docker.n8n.io/n8nio/n8n
   ```
2. Откройте в браузере `http://localhost:5678`.
3. Перейдите в раздел **Workflows** -> **Import from File** и загрузите файл `ai_browser_agent_workflow (3).json`.
4. Настройте **Credentials** для узлов `OpenAI Chat Model`:
   * Выберите тип учетных данных: OpenAI API.
   * **API Key**: `lm-studio` (любой текст).
   * **Base URL**: `http://host.docker.internal:1234/v1` (URL вашего сервера LM Studio).

---

## 🎮 Использование

1. Откройте целевой сайт в браузере (например, `hh.ru`).
2. Кликните на иконку расширения "AI Agent Hands" и нажмите **«Запустить агента»**. Статус изменится на «Жду команду от ИИ».
3. В интерфейсе n8n откройте импортированный workflow.
4. В ноде **«Задание»** (Set) укажите ваш текстовый запрос (`user_request`), профиль кандидата (`candidate_profile`) и правила ответов (`writer_rules`).
5. Нажмите **Execute Workflow** в n8n.
6. Наблюдайте за магией: агент начнет самостоятельно анализировать страницу, кликать по кнопкам, заполнять формы и отправлять отклики!

---

## 🛠 Стек технологий
* **Backend**: Java, Spring Boot 3, Jsoup, Lombok
* **Extension**: JavaScript, Chrome Manifest V3 API, HTML/CSS
* **Orchestration**: n8n, JavaScript (Node.js)
* **AI/LLM**: LM Studio, OpenAI API Format

---
*Разработано в рамках учебного проекта УрФУ.*
