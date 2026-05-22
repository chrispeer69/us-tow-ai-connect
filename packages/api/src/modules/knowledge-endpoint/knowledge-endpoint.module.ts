import { Module } from '@nestjs/common';
import { KnowledgeEndpointController } from './knowledge-endpoint.controller';
import { KnowledgeEndpointService } from './knowledge-endpoint.service';

@Module({
  controllers: [KnowledgeEndpointController],
  providers: [KnowledgeEndpointService],
})
export class KnowledgeEndpointModule {}
