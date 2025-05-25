import "./faker";
import { util } from "../lib/util";

//enable support for WebRTC
util.supports.data = true;
util.randomToken = () => "testToken";
