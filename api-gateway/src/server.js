import mongoose from 'mongoose'
import { shutdownObservability } from '@app/observability'
import { app } from './app.js'
import { config } from './config.js'
import { errorLogAttributes, logger } from './telemetry.js'

const port = config.get('port')
const environment = config.get('node_env')
let server
let shuttingDown = false

try {
  await mongoose.connect(config.get('mongodb_uri'))
  logger.info('API gateway connected to MongoDB', {
    'event.name': 'database.connection.established',
    'event.outcome': 'success',
    'db.system': 'mongodb',
    'db.namespace': mongoose.connection.name,
    'server.address': mongoose.connection.host,
    'server.port': mongoose.connection.port,
    'deployment.environment.name': environment,
    'process.pid': process.pid,
  })

  server = app.listen(port, '0.0.0.0', () => {
    logger.info('API gateway started successfully', {
      'event.name': 'service.lifecycle.started',
      'event.outcome': 'success',
      'server.address': '0.0.0.0',
      'server.port': port,
      'deployment.environment.name': environment,
      'process.pid': process.pid,
    })
  })
} catch (error) {
  logger.error(
    'API gateway failed to initialize',
    {
      'event.name': 'service.lifecycle.start_failed',
      'event.outcome': 'failure',
      'deployment.environment.name': environment,
      'process.pid': process.pid,
      ...errorLogAttributes(error),
    },
  )
  await mongoose.disconnect()
  await shutdownObservability()
  process.exit(1)
}

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  logger.info('API gateway shutdown started', {
    'event.name': 'service.lifecycle.shutdown_started',
    'event.outcome': 'success',
    'process.signal': signal,
    'process.pid': process.pid,
  })

  server.close(async (error) => {
    if (error) {
      logger.error(
        'API gateway HTTP server failed to close cleanly',
        {
          'event.name': 'service.lifecycle.shutdown_failed',
          'event.outcome': 'failure',
          'process.signal': signal,
          'process.pid': process.pid,
          ...errorLogAttributes(error),
        },
      )
    }

    await mongoose.disconnect()
    logger.info('API gateway shutdown completed', {
      'event.name': 'service.lifecycle.shutdown_completed',
      'event.outcome': error ? 'failure' : 'success',
      'process.signal': signal,
      'process.pid': process.pid,
    })
    await shutdownObservability()
    process.exit(error ? 1 : 0)
  })
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
