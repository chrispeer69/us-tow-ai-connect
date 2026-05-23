import { Module } from '@nestjs/common';
import { KnowledgeEndpointController } from './knowledge-endpoint.controller';
import { KnowledgeEndpointService } from './knowledge-endpoint.service';
import { KnowledgePackModule } from '../knowledge-pack/knowledge-pack.module';

@Module({
  imports: [KnowledgePackModule],
  controllers: [KnowledgeEndpointController],
  providers: [KnowledgeEndpointService],
})
export class KnowledgeEndpointModule {}
